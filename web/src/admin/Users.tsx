import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/context';
import { dateTime } from '../lib/format';
import { Field, Modal, Spinner, Toggle } from '../components/ui';
import { PageTitle, useAdmin } from './AdminApp';

interface User { id: string; name: string; email: string; roleKey: string; active: boolean; lastLoginAt: string | null }
interface Role { key: string; name: string; description: string; permissions: string[] }

export function UsersAdmin() {
  const toast = useToast();
  const { staff } = useAdmin();
  const [users, setUsers] = useState<User[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; email: string; role: string; active: boolean; password: string } | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const load = useCallback(() => api<User[]>('/admin/users').then(setUsers), []);
  useEffect(() => {
    void load();
    api<Role[]>('/admin/roles').then(setRoles);
  }, [load]);
  if (!users) return <Spinner />;
  const save = async () => {
    if (!edit) return;
    try {
      const body = { name: edit.name, email: edit.email, role: edit.role, active: edit.active, ...(edit.password ? { password: edit.password } : {}) };
      await api(edit.id ? `/admin/users/${edit.id}` : '/admin/users', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      toast('Usuário salvo.');
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="space-y-5">
      <PageTitle title="Usuários e permissões"><button className="btn-primary" onClick={() => setEdit({ name: '', email: '', role: 'ATTENDANT', active: true, password: '' })}><Plus size={18} /> Novo usuário</button></PageTitle>
      <div className="card divide-y divide-black/5">
        {users.map((u) => (
          <button key={u.id} className={`flex w-full items-center justify-between p-4 text-left ${u.active ? '' : 'opacity-50'}`} onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, role: u.roleKey, active: u.active, password: '' })}>
            <span>
              <span className="font-bold">{u.name}</span> {u.id === staff.id && <span className="chip bg-gold-100">você</span>}
              <span className="block text-xs text-ink-700">{u.email} · último acesso {u.lastLoginAt ? dateTime(u.lastLoginAt) : 'nunca'}</span>
            </span>
            <span className="chip bg-black/5">{roles.find((r) => r.key === u.roleKey)?.name ?? u.roleKey}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {roles.map((r) => (
          <div key={r.key} className="card p-4 text-sm">
            <p className="font-bold">{r.name}</p>
            <p className="text-ink-700">{r.description}</p>
            <p className="mt-2 text-xs text-ink-700">{r.permissions.join(', ')}</p>
          </div>
        ))}
      </div>
      <form
        className="card max-w-md space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/admin/auth/change-password', { body: pw });
            setPw({ currentPassword: '', newPassword: '' });
            toast('Senha alterada.');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
      >
        <h2 className="text-xl font-bold">Alterar minha senha</h2>
        <Field label="Senha atual"><input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Nova senha (mín. 10)"><input className="input" type="password" minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></Field>
        <button className="btn-primary">Alterar</button>
      </form>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Editar usuário' : 'Novo usuário'} footer={<button className="btn-primary w-full" onClick={save}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Nome"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Perfil">
              <select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </Field>
            <Field label={edit.id ? 'Nova senha (opcional)' : 'Senha inicial'} hint="Mínimo 10 caracteres. Alterar perfil/senha encerra as sessões do usuário.">
              <input className="input" type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativo" />
          </div>
        </Modal>
      )}
    </div>
  );
}

interface Log { id: string; actor: string; action: string; entity: string; entityId: string | null; data: unknown; ip: string | null; createdAt: string; user: { name: string } | null }

export function Audit() {
  const [items, setItems] = useState<Log[] | null>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    api<{ total: number; items: Log[] }>(`/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}`).then((r) => {
      setItems(r.items);
      setTotal(r.total);
    });
  }, [page, action]);
  return (
    <div>
      <PageTitle title="Auditoria">
        <select className="input w-auto" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">Todas as ações</option>
          {['order.', 'payment.', 'table.', 'product.', 'combo.', 'settings.', 'user.', 'auth.', 'customer.', 'integration.', 'orderItem.', 'finance.'].map((a) => <option key={a} value={a}>{a.replace('.', '')}</option>)}
        </select>
      </PageTitle>
      {!items ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gold-50 text-left"><tr><th className="p-2">Data</th><th>Quem</th><th>Ação</th><th>Registro</th><th>Detalhes</th></tr></thead>
            <tbody className="divide-y divide-black/5">
              {items.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="p-2 whitespace-nowrap">{dateTime(l.createdAt)}</td>
                  <td>{l.user?.name ?? l.actor}</td>
                  <td className="font-mono text-xs">{l.action}</td>
                  <td className="text-xs">{l.entity} {l.entityId?.slice(-8)}</td>
                  <td className="max-w-md break-all font-mono text-[11px] text-ink-700">{l.data ? JSON.stringify(l.data) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between p-3 text-sm">
            <span>{total} registro(s)</span>
            <span className="flex gap-2">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn-ghost btn-sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Próxima</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
