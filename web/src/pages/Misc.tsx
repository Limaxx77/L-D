import { Link } from 'react-router-dom';
import { MenuView } from '../components/menu';
import { useStore } from '../lib/context';
import { HoursTable, OFFICIAL_WHATSAPP } from '../components/brand';
import { formatPhone } from '../lib/format';

export function MenuPage() {
  const { info } = useStore();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-4xl font-extrabold">Cardápio</h1>
      {info && !info.open.open && (
        <div className="card my-4 bg-brand-50 p-4">
          <p className="font-semibold text-brand-700">{info.closedMessage}</p>
          {info.hours.length > 0 && (
            <div className="mt-3 max-w-sm">
              <HoursTable hours={info.hours} />
            </div>
          )}
        </div>
      )}
      <div className="mt-4">
        <MenuView />
      </div>
    </div>
  );
}

export function Privacy() {
  const { info } = useStore();
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-8 leading-relaxed">
      <h1 className="text-4xl font-extrabold">Política de privacidade</h1>
      <p>
        A {info?.store.name ?? 'Pastel L&D'} trata seus dados pessoais de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>
      <h2 className="text-2xl font-bold">Quais dados coletamos</h2>
      <p>Nome, telefone/WhatsApp, e-mail (opcional), endereço de entrega e o histórico dos seus pedidos. Nas mesas, apenas o nome informado por você.</p>
      <h2 className="text-2xl font-bold">Para que usamos</h2>
      <p>
        Exclusivamente para receber, preparar, entregar e cobrar seus pedidos, enviar atualizações de status (no WhatsApp, somente com sua autorização) e
        cumprir obrigações legais e fiscais. Não vendemos nem compartilhamos seus dados para publicidade.
      </p>
      <h2 className="text-2xl font-bold">Quem tem acesso</h2>
      <p>Somente funcionários autorizados, conforme a função (por exemplo, o entregador vê apenas o endereço das entregas atribuídas a ele). Acessos a dados de clientes são registrados.</p>
      <h2 className="text-2xl font-bold">Seus direitos</h2>
      <p>
        Você pode consultar, corrigir e excluir sua conta a qualquer momento em <Link to="/conta" className="font-semibold underline">Minha conta</Link>. Ao excluir, seus dados pessoais são
        anonimizados; registros financeiros são mantidos sem identificação pelo prazo legal. Para outras solicitações, fale conosco pelo WhatsApp {formatPhone(info?.store.whatsapp ?? OFFICIAL_WHATSAPP)}.
      </p>
    </article>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-5xl font-extrabold text-brand-600">Ops!</h1>
      <p className="mt-2 text-lg">Página não encontrada.</p>
      <Link to="/" className="btn-primary mt-6">
        Voltar ao início
      </Link>
    </div>
  );
}
