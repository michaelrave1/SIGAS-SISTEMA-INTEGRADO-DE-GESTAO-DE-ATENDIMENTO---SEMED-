# Atendimento pelo responsável

Implementação local. Não aplicada ao Supabase remoto. Não houve commit, push ou deploy.

## Arquitetura

Foram examinados os estados canônicos, RPCs transacionais, Server Actions, `os_order_available_actions`, escopo de área/unidade, RBAC, RLS, ciência por encaminhamento, mensagens, reservas de anexos, timeline e gatilhos de auditoria. A implementação amplia essas estruturas. Não há uma segunda tabela de atendimentos nem um workflow paralelo.

A regra de atendimento reside em `os_private.service_workflow_matrix()`. A projeção de ações para a interface e os comandos RPC consultam `service_action_allowed()` e essa matriz. A matriz de triagem/encaminhamento administrativo existente permanece em uso. A interface não decide autorização nem envia livremente um novo status.

## Matriz

| Estado atual | Ação permitida | Novo estado | Permissão | Validações |
|---|---|---|---|---|
| OS aberta com encaminhamento ao usuário | Ciência | Mantido | orders.view | Destinatário, RLS, lock; ciência repetida retorna a data original |
| Encaminhada | Aceitar atribuição | Atribuída | orders.attend | Responsável designado, ciência e versão |
| Atribuída | Iniciar atendimento | Em atendimento | orders.attend | Responsável designado ou administrador, ciência e versão |
| Em atendimento | Diagnóstico, ação realizada, visita, material, observação técnica | Mantido | orders.attend | Tipo ativo do cadastro existente, descrição, data, autor, versão |
| Atribuída / Em atendimento / Aguardando informação | Impedimento ou pendência | Mantido | orders.attend | Descrição e tipo de registro ativo |
| Atribuída / Em atendimento / Aguardando informação | Resolver impedimento/pendência | Mantido | orders.attend | Registro original da mesma OS, ainda não resolvido; novo registro imutável |
| Em atendimento | Atualizar informações operacionais | Mantido | orders.attend | Somente situação do material e observação operacional; demais campos preservados |
| Atribuída / Em atendimento | Solicitar informação | Aguardando informação | orders.wait_information | Solicitante identificado, pergunta obrigatória, mensagem e evento na mesma transação |
| Atribuída / Em atendimento | Colocar em espera | Aguardando informação | orders.wait_information | Motivo fixo e justificativa; estado de retorno preservado |
| Em triagem / Encaminhada | Colocar em espera pelo administrador | Aguardando informação | orders.wait_information | Comportamento administrativo existente |
| Aguardando informação | Retomar atendimento | Estado anterior: Atribuída / Em atendimento | orders.resume | Responsável/administrador e estado de retorno válido; datas de início/fim preservadas em evento |
| Aguardando informação | Retomar triagem/encaminhamento pelo administrador | Estado anterior: Em triagem / Encaminhada | orders.resume | Comportamento administrativo existente |
| Encaminhada / Atribuída | Reencaminhar | Encaminhada | orders.reassign | Administrador/gestor da área, responsável ativo da mesma área, justificativa, versão; nova ciência |
| Atribuída / Em atendimento / Aguardando informação | Solicitar reencaminhamento | Mantido | orders.attend | Solicitação justificada registrada para avaliação pelo gestor; não atribui poderes administrativos ao responsável |
| Encaminhada / Atribuída / Em atendimento / Aguardando informação | Devolver à triagem | Em triagem | orders.return_triage | Responsável designado, administrador ou gestor da área; justificativa; responsável anterior preservado no evento |
| Em atendimento | Concluir | Concluída | orders.complete | Atendimento formal, resumo, solução, observações finais opcionais, nenhuma pendência/impedimento aberto, ciência, versão |
| Concluída / Cancelada | Reabrir | Em triagem | orders.reopen | Autorização existente, justificativa, versão; relatório anterior permanece nos eventos/auditoria |
| OS aberta acessível | Mensagem | Mantido | orders.view | Regras de colaboração existentes, corpo válido, UUID do envio; repetição não duplica |
| OS aberta acessível | Anexo | Mantido | orders.view | Regras existentes de colaboração, MIME, tamanho, extensão, conteúdo, hash, quota, storage privado; UUID do envio e reserva idempotente |

Todas as ações exigem sessão autenticada. As ações técnicas exigem responsabilidade designada e área compatível; o vínculo legado sem área conserva o escopo por unidade. Administrador mantém suas capacidades existentes. Gestor da área não adquire automaticamente capacidade de executar o atendimento técnico. As novas ações não permitem que outro profissional da mesma área execute o atendimento de uma OS que não lhe foi atribuída.

`Concluída` é o valor canônico existente no banco. Não foi substituído por `concluida`, preservando constraints e registros anteriores.

## Persistência e segurança

- Migration nova: `supabase/migrations/202610020003_responsible_service_workflow.sql`.
- `os_order_service_entries` recebe natureza operacional e referência ao registro resolvido. O índice único impede duas resoluções; a FK composta exige a mesma OS. Registros anteriores não são reescritos.
- `os_orders` recebe resumo e observações finais. A solução continua em `resolution`.
- `os_messages` recebe UUID opcional do envio, único por autor. O formulário usa a RPC transacional e o evento de mensagem é criado pelo gatilho.
- A permissão `orders.return_triage` é atribuída aos perfis de sistema admin, responsible e area_manager. Perfis personalizados não recebem novas permissões automaticamente.
- RPCs usam locks e versão esperada. Duplo clique fica desabilitado na interface; requisições repetidas de workflow são rejeitadas por conflito de versão. Ciência, mensagem e reserva/confirmação de anexo usam idempotência própria.
- A conclusão sem resumo e a RPC genérica de alteração de status ficam bloqueadas. Reabertura sem versão também fica bloqueada.
- Eventos guardam autor, vínculo, data do servidor, estado anterior/novo e metadados. Os gatilhos de auditoria existentes continuam registrando mudanças. Anexos permanecem privados e mensagens, arquivos e registros anteriores são preservados.
- A consulta de pendências abertas é independente da paginação dos atendimentos; pendências antigas continuam acessíveis para resolução.

## Arquivos envolvidos

- `src/app/(app)/ordens/[id]/page.tsx`: consulta e projeção das novas ações/pendências.
- `src/app/actions/orders.ts`: comando operacional, conclusão e mensagens.
- `src/app/actions/attachments.ts`: identificador do envio e confirmação de upload concorrente.
- `src/components/order-details/order-service.tsx`: registros operacionais e resolução.
- `src/components/order-details/order-workflow-actions.tsx`: conclusão completa e botões com loading.
- `src/components/order-details/order-activity.tsx`, `order-attachments.tsx`: envio idempotente e loading.
- `src/components/order-details/order-summary.tsx`, `types.ts`: resumo, observações e contrato.
- `src/lib/order-workflow.ts`, `domain.ts`, `database.types.ts`: contratos dos novos campos e ações.
- `src/lib/order-timeline.ts`: nomes dos novos eventos e distinção entre espera e solicitação de informação.
- `src/lib/authorization-core.ts`, `authorization-policy.ts`: permissão de devolução e proteção das Server Actions.
- `tests/responsible-service.test.mjs`: fluxo completo em instalação limpa e atualização preservando histórico.
- Testes existentes ajustados: ciência, fluxo transacional, RLS do novo fluxo, contrato RBAC. Os testes do contrato legado e do reparo histórico usam o estado anterior à nova migration; a suíte nova e as demais suítes de RLS/RBAC exercitam o schema atual.

## Validação e limites

Testes locais PostgreSQL/PGlite verificam ciência e repetição, início, registros sucessivos de todos os tipos, mensagens, anexos, espera/retomada, pedido de informação com destinatário, pedido de encaminhamento, reatribuição autorizada, nova ciência, devolução, impedimentos/pendências/resolução, conclusão, reabertura, timeline, auditoria, falta de autorização, outro profissional/área, mudança de área, estado incompatível e repetição por versão antiga. A suíte existente cobre múltiplas OS pendentes de ciência.

A publicação depende da revisão/aplicação autorizada da migration e da atualização conjunta da aplicação. A nova assinatura de conclusão exige atualizar eventuais clientes externos que utilizem a assinatura antiga. A validação local não substitui um teste autenticado no navegador após a implantação; produção não foi modificada.

Verificações executadas: TypeScript, lint, suíte completa de 93 testes e build de produção local. A compilação exigiu execução fora da restrição de acesso à pasta `.next`; não realizou deploy. Nenhuma migration anterior foi alterada.
