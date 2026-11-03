import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useStore, useToast } from '../lib/context';
import { brl, centsToInput, parseBRL } from '../lib/format';
import { Field, Modal, Spinner, Toggle } from '../components/ui';
import { ImageUploader } from '../components/ImageUploader';
import { productImage } from '../components/menu';
import { PageTitle } from './AdminApp';

interface Category { id: string; name: string; slug: string; sortOrder: number; active: boolean; _count?: { products: number } }
interface Option { id?: string; brand: string | null; flavor: string | null; size: string | null; priceCents: number | null; available: boolean; sortOrder: number }
interface AdminProduct {
  id: string; kind: 'PASTEL' | 'DRINK' | 'OTHER'; categoryId: string; name: string; description: string; priceCents: number; promoPriceCents: number | null;
  costCents: number | null; rawAvailable: boolean; available: boolean; stockQty: number | null; sortOrder: number; active: boolean; imageUrl: string | null; options: Option[]; category: { name: string };
}

function useList<T>(path: string) {
  const toast = useToast();
  const [items, setItems] = useState<T[] | null>(null);
  const load = useCallback(() => api<T[]>(path).then(setItems).catch((e) => toast((e as Error).message, 'error')), [path, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  return { items, load };
}

const KIND_LABEL = { PASTEL: 'Pastel', DRINK: 'Bebida', OTHER: 'Outro' };

export function Products() {
  const toast = useToast();
  const { reload: reloadMenu } = useStore();
  const { items, load } = useList<AdminProduct>('/admin/catalog/products');
  const { items: cats } = useList<Category>('/admin/catalog/categories');
  const [edit, setEdit] = useState<Partial<AdminProduct> | null>(null);
  if (!items || !cats) return <Spinner />;
  const refresh = () => {
    void load();
    void reloadMenu();
  };
  const toggle = async (p: AdminProduct) => {
    try {
      await api(`/admin/catalog/products/${p.id}/availability`, { method: 'PATCH', body: { available: !p.rawAvailable } });
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div>
      <PageTitle title="Produtos">
        <button className="btn-primary" onClick={() => setEdit({ kind: 'PASTEL', categoryId: cats[0]?.id, active: true, rawAvailable: true, options: [], description: '', sortOrder: items.length + 1 })}>
          <Plus size={18} /> Novo produto
        </button>
      </PageTitle>
      {!cats.length && <p className="mb-4 font-semibold text-brand-700">Cadastre uma categoria antes de criar produtos.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <div key={p.id} className={`card flex gap-3 p-3 ${p.active ? '' : 'opacity-50'}`}>
            <img src={productImage(p)} alt="" className="h-20 w-20 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{p.name}</p>
              <p className="text-xs text-ink-700">{p.category.name} · {KIND_LABEL[p.kind]}{p.stockQty !== null ? ` · estoque ${p.stockQty}` : ''}</p>
              <p className="font-bold text-brand-600">
                {p.promoPriceCents != null && <span className="mr-1 text-xs text-black/40 line-through">{brl(p.priceCents)}</span>}
                {brl(p.promoPriceCents ?? p.priceCents)}
              </p>
              {p.options.length > 0 && <p className="truncate text-xs text-ink-700">{p.options.length} opção(ões)</p>}
              <div className="mt-1 flex items-center justify-between">
                <Toggle checked={p.rawAvailable} onChange={() => toggle(p)} label={p.rawAvailable ? 'Disponível' : 'Indisponível'} />
                <button className="btn-ghost btn-sm" onClick={() => setEdit(p)} aria-label="Editar"><Pencil size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {edit && <ProductForm product={edit} cats={cats} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

function ProductForm({ product, cats, onClose, onSaved }: { product: Partial<AdminProduct>; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [p, setP] = useState(product);
  const [price, setPrice] = useState(centsToInput(product.priceCents));
  const [promo, setPromo] = useState(centsToInput(product.promoPriceCents));
  const [cost, setCost] = useState(centsToInput(product.costCents));
  const [stock, setStock] = useState(product.stockQty == null ? '' : String(product.stockQty));
  const [options, setOptions] = useState<Option[]>(product.options ?? []);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const priceCents = parseBRL(price);
    if (priceCents == null) return toast('Informe o preço.', 'error');
    setBusy(true);
    try {
      const body = {
        categoryId: p.categoryId,
        kind: p.kind,
        name: p.name,
        description: p.description ?? '',
        priceCents,
        promoPriceCents: parseBRL(promo),
        costCents: parseBRL(cost),
        available: p.rawAvailable ?? true,
        stockQty: stock === '' ? null : Number(stock),
        sortOrder: Number(p.sortOrder ?? 0),
        active: p.active ?? true,
        options: options.map((o, i) => ({ ...o, sortOrder: i })),
      };
      const saved = await api<{ id: string }>(p.id ? `/admin/catalog/products/${p.id}` : '/admin/catalog/products', { method: p.id ? 'PUT' : 'POST', body });
      toast('Produto salvo.');
      onSaved();
      if (!p.id) setP({ ...p, id: saved.id }); // permite adicionar foto logo após criar
      else onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!p.id || !window.confirm(`Excluir ${p.name}? O histórico de vendas é preservado.`)) return;
    await api(`/admin/catalog/products/${p.id}`, { method: 'DELETE' });
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} size="lg" title={p.id ? `Editar ${product.name ?? 'produto'}` : 'Novo produto'} footer={
      <div className="flex justify-between gap-2">
        {p.id ? <button className="btn-danger btn-sm" onClick={remove}><Trash2 size={14} /> Excluir</button> : <span />}
        <button className="btn-primary" disabled={busy} onClick={save}>Salvar</button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="input" value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Categoria">
          <select className="input" value={p.categoryId ?? ''} onChange={(e) => setP({ ...p, categoryId: e.target.value })}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo" hint="Pastéis e bebidas podem ser escolhidos nos combos.">
          <select className="input" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as AdminProduct['kind'] })}>
            <option value="PASTEL">Pastel</option><option value="DRINK">Bebida</option><option value="OTHER">Outro</option>
          </select>
        </Field>
        <Field label="Ordem de exibição"><input className="input" type="number" min={0} value={p.sortOrder ?? 0} onChange={(e) => setP({ ...p, sortOrder: Number(e.target.value) })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Descrição" hint="Descreva apenas ingredientes confirmados.">
            <textarea className="input" maxLength={500} value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} />
          </Field>
        </div>
        <Field label="Preço (R$)"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="8,00" /></Field>
        <Field label="Preço promocional (opcional)"><input className="input" inputMode="decimal" value={promo} onChange={(e) => setPromo(e.target.value)} /></Field>
        <Field label="Custo unitário (opcional)" hint="Usado no lucro estimado."><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Estoque (opcional)" hint="Em branco = sem controle."><input className="input" type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-5 sm:col-span-2">
          <Toggle checked={p.rawAvailable ?? true} onChange={(v) => setP({ ...p, rawAvailable: v })} label="Disponível" />
          <Toggle checked={p.active ?? true} onChange={(v) => setP({ ...p, active: v })} label="Ativo no cardápio" />
        </div>
      </div>

      <div className="mt-5">
        <p className="label">Opções (marca / sabor / tamanho)</p>
        <p className="mb-2 text-xs text-ink-700">Ex.: refrigerantes. Deixe o preço em branco para usar o preço do produto. Se houver opções, o cliente precisa escolher uma.</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={o.id ?? i} className="grid grid-cols-2 gap-2 rounded-2xl p-2 ring-1 ring-black/10 sm:grid-cols-[1fr_1fr_1fr_6rem_auto_auto]">
              {(['brand', 'flavor', 'size'] as const).map((k) => (
                <input key={k} className="input py-1.5 text-sm" placeholder={{ brand: 'Marca', flavor: 'Sabor', size: 'Tamanho' }[k]} value={o[k] ?? ''} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, [k]: e.target.value || null } : x)))} />
              ))}
              <input className="input py-1.5 text-sm" placeholder="Preço" inputMode="decimal" value={centsToInput(o.priceCents)} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, priceCents: parseBRL(e.target.value) } : x)))} />
              <Toggle checked={o.available} onChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, available: v } : x)))} />
              <button className="text-brand-700" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remover opção"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn-ghost btn-sm mt-2" onClick={() => setOptions([...options, { brand: null, flavor: null, size: null, priceCents: null, available: true, sortOrder: options.length }])}><Plus size={14} /> Adicionar opção</button>
      </div>

      <div className="mt-5">
        <p className="label">Fotografia</p>
        {p.id ? (
          <ImageUploader currentUrl={p.imageUrl ?? null} uploadPath={`/admin/catalog/products/${p.id}/image`} deletePath={`/admin/catalog/products/${p.id}/image`} onChange={(url) => { setP({ ...p, imageUrl: url }); onSaved(); }} />
        ) : (
          <p className="text-sm text-ink-700">Salve o produto para adicionar a foto.</p>
        )}
      </div>
    </Modal>
  );
}

interface AdminCombo {
  id: string; name: string; description: string; priceCents: number; pastelQty: number; drinkQty: number; featured: boolean; rawAvailable: boolean; active: boolean;
  dailyLimit: number | null; remainingToday: number | null; sortOrder: number; imageUrl: string | null; regularCents: number; savingsCents: number;
}

export function Combos() {
  const { reload: reloadMenu } = useStore();
  const { items, load } = useList<AdminCombo>('/admin/catalog/combos');
  const [edit, setEdit] = useState<Partial<AdminCombo> | null>(null);
  if (!items) return <Spinner />;
  const refresh = () => {
    void load();
    void reloadMenu();
  };
  return (
    <div>
      <PageTitle title="Combos">
        <button className="btn-primary" onClick={() => setEdit({ pastelQty: 1, drinkQty: 1, active: true, rawAvailable: true, featured: false, description: '', sortOrder: items.length + 1 })}><Plus size={18} /> Novo combo</button>
      </PageTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <button key={c.id} onClick={() => setEdit(c)} className={`card flex gap-3 p-3 text-left ${c.active ? '' : 'opacity-50'}`}>
            <img src={c.imageUrl || '/images/combo.svg'} alt="" className="h-20 w-20 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{c.name} {c.featured && <span className="chip bg-gold-200 text-gold-700">Destaque</span>}</p>
              <p className="text-xs text-ink-700">{c.pastelQty} pastéis + {c.drinkQty} refri{c.dailyLimit !== null ? ` · limite ${c.dailyLimit}/dia` : ''}</p>
              <p className="font-bold text-brand-600">{brl(c.priceCents)} <span className="text-xs font-semibold text-green-700">economia {brl(c.savingsCents)}</span></p>
              {!c.rawAvailable && <span className="chip bg-black/10">Indisponível</span>}
            </div>
          </button>
        ))}
      </div>
      {edit && <ComboForm combo={edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

function ComboForm({ combo, onClose, onSaved }: { combo: Partial<AdminCombo>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [c, setC] = useState(combo);
  const [price, setPrice] = useState(centsToInput(combo.priceCents));
  const [limit, setLimit] = useState(combo.dailyLimit == null ? '' : String(combo.dailyLimit));
  const save = async () => {
    const priceCents = parseBRL(price);
    if (priceCents == null) return toast('Informe o preço.', 'error');
    try {
      const body = { name: c.name, description: c.description ?? '', priceCents, pastelQty: Number(c.pastelQty), drinkQty: Number(c.drinkQty), dailyLimit: limit === '' ? null : Number(limit), available: c.rawAvailable ?? true, active: c.active ?? true, featured: !!c.featured, sortOrder: Number(c.sortOrder ?? 0) };
      const r = await api<{ id: string }>(c.id ? `/admin/catalog/combos/${c.id}` : '/admin/catalog/combos', { method: c.id ? 'PUT' : 'POST', body });
      toast('Combo salvo.');
      onSaved();
      if (!c.id) setC({ ...c, id: r.id });
      else onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const remove = async () => {
    if (!c.id || !window.confirm(`Excluir ${c.name}?`)) return;
    await api(`/admin/catalog/combos/${c.id}`, { method: 'DELETE' });
    onSaved();
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={c.id ? `Editar ${combo.name ?? 'combo'}` : 'Novo combo'} footer={
      <div className="flex justify-between gap-2">
        {c.id ? <button className="btn-danger btn-sm" onClick={remove}><Trash2 size={14} /> Excluir</button> : <span />}
        <button className="btn-primary" onClick={save}>Salvar</button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="input" value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <Field label="Preço final (R$)" hint="O desconto já está neste preço."><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Quantidade de pastéis"><input className="input" type="number" min={0} value={c.pastelQty ?? 0} onChange={(e) => setC({ ...c, pastelQty: Number(e.target.value) })} /></Field>
        <Field label="Quantidade de refrigerantes"><input className="input" type="number" min={0} value={c.drinkQty ?? 0} onChange={(e) => setC({ ...c, drinkQty: Number(e.target.value) })} /></Field>
        <Field label="Limite por dia (opcional)"><input className="input" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        <Field label="Ordem"><input className="input" type="number" min={0} value={c.sortOrder ?? 0} onChange={(e) => setC({ ...c, sortOrder: Number(e.target.value) })} /></Field>
        <div className="sm:col-span-2"><Field label="Descrição / regras de escolha"><textarea className="input" value={c.description ?? ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field></div>
        <div className="flex flex-wrap gap-5 sm:col-span-2">
          <Toggle checked={c.rawAvailable ?? true} onChange={(v) => setC({ ...c, rawAvailable: v })} label="Disponível" />
          <Toggle checked={c.active ?? true} onChange={(v) => setC({ ...c, active: v })} label="Ativo" />
          <Toggle checked={!!c.featured} onChange={(v) => setC({ ...c, featured: v })} label="Destaque na página inicial" />
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-700">O cliente escolhe livremente os sabores dos pastéis e os refrigerantes disponíveis, respeitando as quantidades acima.</p>
      <div className="mt-4">
        <p className="label">Fotografia</p>
        {c.id ? (
          <ImageUploader currentUrl={c.imageUrl ?? null} uploadPath={`/admin/catalog/combos/${c.id}/image`} deletePath={`/admin/catalog/combos/${c.id}/image`} onChange={(url) => { setC({ ...c, imageUrl: url }); onSaved(); }} />
        ) : (
          <p className="text-sm text-ink-700">Salve o combo para adicionar a foto.</p>
        )}
      </div>
    </Modal>
  );
}

export function Categories() {
  const toast = useToast();
  const { reload: reloadMenu } = useStore();
  const { items, load } = useList<Category>('/admin/catalog/categories');
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  if (!items) return <Spinner />;
  const save = async () => {
    if (!edit) return;
    try {
      const body = { name: edit.name, slug: edit.slug || (edit.name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), sortOrder: Number(edit.sortOrder ?? 0), active: edit.active ?? true };
      await api(edit.id ? `/admin/catalog/categories/${edit.id}` : '/admin/catalog/categories', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      void load();
      void reloadMenu();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const remove = async (c: Category) => {
    if (!window.confirm(`Excluir a categoria ${c.name}?`)) return;
    try {
      await api(`/admin/catalog/categories/${c.id}`, { method: 'DELETE' });
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div>
      <PageTitle title="Categorias"><button className="btn-primary" onClick={() => setEdit({ active: true, sortOrder: items.length + 1 })}><Plus size={18} /> Nova categoria</button></PageTitle>
      <div className="card divide-y divide-black/5">
        {items.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-bold">{c.name} {!c.active && <span className="chip bg-black/10">Inativa</span>}</p>
              <p className="text-xs text-ink-700">{c._count?.products ?? 0} produto(s) · ordem {c.sortOrder}</p>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil size={14} /></button>
              <button className="btn-danger btn-sm" onClick={() => remove(c)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Editar categoria' : 'Nova categoria'} footer={<button className="btn-primary w-full" onClick={save}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Nome"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Ordem"><input className="input" type="number" value={edit.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} /></Field>
            <Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" />
          </div>
        </Modal>
      )}
    </div>
  );
}
