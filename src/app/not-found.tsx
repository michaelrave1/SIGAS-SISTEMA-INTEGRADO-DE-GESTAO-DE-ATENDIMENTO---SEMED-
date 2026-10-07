import { BackButton } from "@/components/back-button";
export default function NotFound() {
  return (
    <main className="access-page">
      <section className="access-card">
        <h1>Registro não encontrado</h1>
        <p>O registro não existe ou não está disponível para seu vínculo.</p>
        <BackButton standalone />
      </section>
    </main>
  );
}
