# Cadastros do Sistema

Implementação local, sem aplicação no Supabase remoto, commit, push ou deploy.

## Estrutura

Administração → Cadastros do Sistema reúne:

- Classificações das Solicitações: Áreas, Naturezas por Área, Tipos por Natureza e Descrições / Detalhamentos.
- Unidades: reutiliza `/unidades`.
- Profissionais e Vínculos: reutiliza `/usuarios`, incluindo as operações existentes de ativação e desativação.
- Transporte Escolar: reutiliza os cadastros de motoristas, veículos e rotas.
- Tipos de Registro de Atendimento: novo cadastro com nome, ordem, ativação, desativação e exclusão sem histórico.

As classificações continuam sendo combinações em `os_catalogs`, sem tabelas duplicadas de áreas, naturezas ou tipos. A navegação filtra os níveis da hierarquia e o formulário permite reutilizar valores existentes. A ativação/desativação atua sobre cada combinação; não altera todos os registros de uma área implicitamente. Novas combinações podem ser preenchidas progressivamente.

## Proteções

- Áreas permanecem em caixa alta e seus nomes existentes não podem ser renomeados pelo CRUD. As regras especiais de Transporte Escolar e Segurança Escolar e o escopo dos profissionais permanecem vigentes.
- Alterações nos dados de cadastros com referências históricas são recusadas; pode-se desativar o registro e criar outro. Alteração de nome e de situação permanece disponível.
- Exclusões de classificações, transporte e unidades verificam referências atuais e históricas. Áreas com vínculos não podem ser excluídas.
- A tabela nova de tipos mantém uma chave imutável. Os cinco valores anteriores são cadastrados; outros valores históricos são preservados e inicialmente desativados.
- Cada novo atendimento guarda o nome do tipo no momento do registro (`entry_type_name`). Registros anteriores continuam exibindo o texto original, sem atualização retroativa.
- O banco rejeita tipos desconhecidos ou inativos. A FK e o índice de `entry_type` protegem as referências.
- As operações administrativas exigem administrador e a permissão correspondente. A permissão nova `system_catalogs.manage` é concedida ao perfil de sistema `admin`; não concede acesso a ordens de outras áreas/unidades.
- Auditoria registra criação, alterações, mudanças de situação e exclusões com dados anteriores/posteriores. Workflow, papéis técnicos, permissões, prioridades, material e motivos de espera não viraram cadastros livres.

## Migration

`supabase/migrations/202609300001_system_catalogs.sql`

Cria `os_service_entry_types`, FK/índice e coluna de apresentação em `os_order_service_entries`, RPCs de cadastro/exclusão, proteção de histórico em `os_catalogs`, validação da hierarquia no CRUD, permissão administrativa, RLS, auditoria e grants. Nenhuma migration antiga foi alterada.

## Arquivos da implementação

- `src/app/(app)/administracao/cadastros/page.tsx`
- `src/app/(app)/administracao/cadastros/atendimentos/page.tsx`
- `src/app/(app)/cadastros/[kind]/page.tsx`
- `src/app/(app)/unidades/page.tsx`
- `src/app/(app)/ordens/[id]/page.tsx`
- `src/app/actions/system-catalogs.ts`
- `src/app/actions/administration.ts`
- `src/components/classification-fields.tsx`
- `src/components/order-details/order-service.tsx`
- `src/components/order-details/types.ts`
- `src/components/permission-matrix.tsx`
- `src/components/shell.tsx`
- `src/lib/navigation.ts`
- `src/lib/authorization-core.ts`
- `src/lib/database.types.ts`
- `src/lib/order-workflow.ts`
- `tests/system-catalogs.test.mjs`
- `tests/area-manager-repair.test.mjs`
- `tests/new-flow-rls.test.mjs`
- `tests/transactional-order-operations.test.mjs`

## Validação e publicação futura

TypeScript, lint, suíte de testes e build executados localmente. A migration foi testada com PGlite em banco limpo e com registros históricos. A suíte também verifica isolamento entre áreas/unidades e RBAC.

A validação visual autenticada em ambiente integrado continua pendente. Antes de uma publicação futura autorizada, conferir as migrations prévias do ambiente, aplicar a nova migration e somente então publicar a aplicação: as telas passam a depender do novo schema. Nenhuma operação remota faz parte desta entrega.
