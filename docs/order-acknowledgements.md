# Ciência obrigatória de encaminhamentos

O layout autenticado consulta as pendências no servidor e apresenta um diálogo modal com ciência individual. O conteúdo do sistema fica inerte enquanto houver pendências ou falha na consulta. Escape e clique fora não fecham o diálogo. A lista é renovada depois de cada ciência, na navegação, ao retornar à aba e a cada 30 segundos.

`os_order_dispatches` registra OS, destinatário, momento do encaminhamento, ciência, autor da ciência e evento de origem. Cada evento de encaminhamento profissional ou reatribuição gera um registro independente, na mesma transação. O aceite da atribuição não cria outro encaminhamento.

A RPC de ciência autentica o destinatário, verifica a permissão `orders.view` e o escopo atual da OS, bloqueia as linhas para serializar confirmações e grava o horário com `clock_timestamp()`. Repetições retornam a ciência já gravada sem gerar outro evento. Ciência e aceite continuam sendo operações distintas; a ciência não altera status ou versão da OS.

As pendências incluem encaminhamentos sem ciência de OS ativas e não concluídas/canceladas, desde que o destinatário mantenha autorização para consultar a OS. Encerramento, exclusão lógica ou revogação de acesso remove a pendência da lista sem inventar ciência. O histórico e a auditoria preservam os registros.

A implantação cria uma pendência inicial apenas para o destinatário atual de OS no estado `Encaminhada`. Usa o último evento correspondente ou os horários existentes; quando não houver horário registrado, usa o momento da implantação. Esses registros são identificados por `origem='implantacao'`. Nenhum evento ou dado anterior é sobrescrito.

## Arquivos

- `supabase/migrations/202610010001_order_acknowledgements.sql`
- `src/app/(app)/layout.tsx`
- `src/app/actions/acknowledgements.ts`
- `src/components/acknowledgement-gate.tsx`
- `src/lib/order-acknowledgements.ts`
- `src/lib/database.types.ts`
- `src/lib/order-timeline.ts`
- `src/app/globals.css`
- `tests/order-acknowledgements.test.mjs`

## Validação

Testes locais com PGlite cobrem banco limpo e implantação com OS existente, ciência única, múltiplas OS, idempotência, reencaminhamento, histórico, RLS, bloqueio de outros usuários, encerramento, exclusão lógica e revogação de permissão. Não equivalem a um teste com conexões concorrentes de PostgreSQL de produção.

A aplicação deve receber esta migration e suas dependências antes da publicação. Aplicação remota, commit, push e deploy não fazem parte desta implementação. A validação visual autenticada em ambiente integrado fica pendente até a migration ser aplicada nesse ambiente.
