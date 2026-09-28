# Login Google — OS SEMED

## Fluxo revisado

`src/app/actions/auth.ts` executa `supabase.auth.signInWithOAuth({ provider: "google" })` no servidor. Solicita somente `openid email profile`, seleciona a conta e envia `hd=edu.uberabadigital.com.br`. `hd` é apenas uma orientação ao Google: a autorização real é validada no callback.

O `redirectTo` é `${applicationOrigin()}/auth/callback`. A origem é obtida de `NEXT_PUBLIC_APP_URL`; se ausente, o código usa os cabeçalhos Origin/Host da requisição. Em produção configure explicitamente:

```dotenv
NEXT_PUBLIC_APP_URL=https://os-semed.vercel.app
ALLOWED_GOOGLE_DOMAINS=edu.uberabadigital.com.br
```

O domínio institucional é o único aceito pelo código, mesmo se a lista de configuração incluir outros domínios. Configuração explicitamente vazia desabilita o botão. Na ausência da variável, o domínio institucional é o padrão.

`src/app/auth/callback/route.ts` recebe o código, chama `exchangeCodeForSession(code)` e consulta `getUser()`. O cliente SSR persiste a sessão em cookies usando `cookies()` do Next.js. A rota verifica identidade Google, e-mail confirmado e domínio exato, rejeitando contas externas e subdomínios e encerrando a sessão local. Depois exige o vínculo profissional através de `os_claim_professional_identity` e determina a primeira rota autorizada. Não concede acesso apenas por pertencer ao domínio.

## Dois retornos diferentes

1. Google → Supabase: `https://ouixjkqcuqpfmhmmsdxg.supabase.co/auth/v1/callback`. Esse endereço pertence às Authorized redirect URIs do cliente OAuth no Google Cloud.
2. Supabase → aplicação: `https://os-semed.vercel.app/auth/callback`. Esse endereço pertence à lista Redirect URLs do Supabase e deve coincidir com o `redirectTo` da aplicação.

## Configuração remota observada em 28/09/2026

- Google Provider: habilitado.
- Email Provider: desabilitado após validar o login Google completo com a conta institucional.
- Site URL observada ao concluir: `https://sigas-detic-michael.vercel.app/` (mantida).
- O callback exato `https://os-semed.vercel.app/auth/callback` foi adicionado à lista Redirect URLs; os demais retornos foram preservados.
- A inclusão foi concluída após aprovação explícita do responsável. O salvamento foi confirmado no painel.

## Credenciais e limites da validação

Client ID e Client Secret do Google são configurados somente no Supabase Google Provider. Não adicionar Client Secret, service-role ou credenciais administrativas a `NEXT_PUBLIC_*`, componentes de cliente ou repositório. O app usa somente URL Supabase e chave publishable, além da sessão do usuário.

Conforme a instrução final, o formulário de e-mail/senha, a função `login` com `signInWithPassword` e sua exportação foram removidos do aplicativo. A tela oferece apenas Google Workspace. Contas, vínculos e dados existentes não foram excluídos. O provedor Email também foi desativado no Supabase; não foi apenas removido o formulário.

A versão com Google exclusivo já estava publicada ao concluir a configuração. O teste completo com a conta institucional passou pelo seletor Google, retornou pelo callback e abriu /painel, sem erros no console. O endereço enviado ao Google confirmou redirect_to=https://os-semed.vercel.app/auth/callback, redirect_uri=https://ouixjkqcuqpfmhmmsdxg.supabase.co/auth/v1/callback e hd=edu.uberabadigital.com.br. A política do callback não substitui a configuração de público interno no Google Workspace nem uma eventual política de cadastro no Supabase Auth para impedir a criação de usuários externos diretamente no provedor.

Referência: https://supabase.com/docs/guides/auth/social-login/auth-google
