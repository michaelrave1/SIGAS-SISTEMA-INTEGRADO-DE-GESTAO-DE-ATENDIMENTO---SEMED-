import { deleteOrder } from "@/app/actions/orders";

export function OrderDelete({ id, version }: { id: string; version: number }) {
  return (
    <section className="card">
      <details>
        <summary>Excluir ordem de serviço</summary>
        <p>A OS será removida das telas e não poderá mais receber atendimento. O histórico e os anexos serão preservados para auditoria.</p>
        <form action={deleteOrder}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <label>
            Digite EXCLUIR para confirmar a exclusão desta OS
            <input name="confirmation" required pattern="EXCLUIR" autoComplete="off" />
          </label>
          <button type="submit">Confirmar exclusão da OS</button>
        </form>
      </details>
    </section>
  );
}
