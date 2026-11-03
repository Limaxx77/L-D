import { useEffect, useMemo, useState } from 'react';
import { Heart, Plus, Sparkles, Flame } from 'lucide-react';
import { useCart, useCustomer, useStore, useToast } from '../lib/context';
import { brl } from '../lib/format';
import { api } from '../lib/api';
import type { Combo, Product, Selection } from '../lib/types';
import { Modal, QtyStepper, Spinner } from './ui';

const FALLBACK_IMG: Record<string, string> = { PASTEL: '/images/pastel-carne.svg', DRINK: '/images/refrigerante.svg', OTHER: '/images/pastel-pizza.svg' };

export function productImage(p: { imageUrl: string | null; kind?: string }) {
  return p.imageUrl || FALLBACK_IMG[p.kind ?? 'PASTEL'];
}

function effectivePrice(p: Product, optionId?: string | null) {
  const o = p.options.find((x) => x.id === optionId);
  return o?.priceCents ?? p.promoPriceCents ?? p.priceCents;
}

export function ProductCard({ p, onOpen, favorite, onToggleFavorite }: { p: Product; onOpen: () => void; favorite?: boolean; onToggleFavorite?: () => void }) {
  return (
    <div className={`card group relative flex gap-3 overflow-hidden p-3 transition hover:shadow-md ${p.available ? '' : 'opacity-60'}`}>
      <button onClick={onOpen} disabled={!p.available} className="flex flex-1 gap-3 text-left" aria-label={`Ver ${p.name}`}>
        <img src={productImage(p)} alt={p.name} loading="lazy" className="h-24 w-24 shrink-0 rounded-2xl bg-gold-100 object-cover sm:h-28 sm:w-28" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-lg font-bold leading-tight">{p.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-ink-700">{p.description}</p>
          <div className="mt-auto flex items-end gap-2 pt-2">
            {p.promoPriceCents != null && <span className="text-sm text-black/40 line-through">{brl(p.priceCents)}</span>}
            <span className="text-lg font-extrabold text-brand-600">
              {p.options.some((o) => o.priceCents != null) ? 'a partir de ' : ''}
              {brl(Math.min(effectivePrice(p), ...p.options.map((o) => o.priceCents ?? effectivePrice(p))))}
            </span>
            {!p.available && <span className="chip bg-black/10 text-ink-700">Indisponível</span>}
          </div>
        </div>
      </button>
      {onToggleFavorite && (
        <button onClick={onToggleFavorite} className="absolute right-3 top-3 rounded-full bg-white/90 p-1.5 shadow" aria-label={favorite ? 'Remover dos favoritos' : 'Favoritar'}>
          <Heart size={18} className={favorite ? 'fill-brand-600 text-brand-600' : 'text-black/40'} />
        </button>
      )}
      {p.available && (
        <button onClick={onOpen} className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-white shadow-lg transition group-hover:scale-110" aria-label={`Adicionar ${p.name}`}>
          <Plus size={20} />
        </button>
      )}
    </div>
  );
}

export function ComboCard({ c, onOpen, compact }: { c: Combo; onOpen: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onOpen}
      disabled={!c.available}
      className={`card group relative flex w-full flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lg ${c.available ? '' : 'opacity-60'} ${compact ? 'min-w-[250px] snap-start' : ''}`}
    >
      <div className="relative">
        <img src={c.imageUrl || '/images/combo.svg'} alt={c.name} loading="lazy" className="h-36 w-full bg-gold-100 object-cover" />
        {c.savingsCents > 0 && (
          <span className="chip absolute left-3 top-3 bg-brand-600 py-1 text-white shadow">
            <Flame size={14} /> Economize {brl(c.savingsCents)}
          </span>
        )}
        {c.remainingToday !== null && c.remainingToday > 0 && c.remainingToday <= 5 && (
          <span className="chip absolute right-3 top-3 bg-ink-900 text-white">Restam {c.remainingToday} hoje</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-xl font-extrabold leading-tight">{c.name}</h3>
        <p className="text-sm text-ink-700">
          {c.pastelQty} pastel{c.pastelQty !== 1 ? 'éis' : ''}
          {c.drinkQty ? ` + ${c.drinkQty} refrigerante${c.drinkQty > 1 ? 's' : ''}` : ''}
        </p>
        <div className="mt-3 flex items-end justify-between">
          <div>
            {c.regularCents > c.priceCents && <div className="text-xs text-black/40 line-through">{brl(c.regularCents)}</div>}
            <div className="text-2xl font-extrabold text-brand-600">{brl(c.priceCents)}</div>
          </div>
          <span className={`btn-sm ${c.available ? 'btn-gold' : 'btn-ghost'}`}>{c.available ? 'Montar' : 'Esgotado'}</span>
        </div>
      </div>
    </button>
  );
}

export function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [optionId, setOptionId] = useState<string | null>(null);
  const p = product;
  if (!p) return null;
  const availableOptions = p.options.filter((o) => o.available);
  const needsOption = availableOptions.length > 0;
  const option = p.options.find((o) => o.id === optionId);
  const unit = effectivePrice(p, optionId);

  const add = () => {
    if (needsOption && !optionId) return toast('Escolha uma opção.', 'error');
    cart.add({
      input: { type: 'product', productId: p.id, optionId, quantity: qty, notes: notes.trim() || null },
      name: option?.label ? `${p.name} (${option.label})` : p.name,
      unitPriceCents: unit,
      imageUrl: p.imageUrl,
    });
    toast(`${qty}x ${p.name} adicionado ao carrinho`);
    setQty(1);
    setNotes('');
    setOptionId(null);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={p.name}
      footer={
        <div className="flex items-center justify-between gap-3">
          <QtyStepper value={qty} onChange={setQty} min={1} />
          <button className="btn-primary flex-1" onClick={add} disabled={!p.available}>
            Adicionar {brl(unit * qty)}
          </button>
        </div>
      }
    >
      <img src={productImage(p)} alt={p.name} className="mb-4 h-52 w-full rounded-2xl bg-gold-100 object-cover" />
      {p.description && <p className="text-ink-700">{p.description}</p>}
      {needsOption && (
        <div className="mt-4">
          <p className="label">Escolha a opção</p>
          <div className="grid gap-2">
            {p.options.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-center justify-between rounded-2xl px-4 py-3 ring-1 ${optionId === o.id ? 'bg-gold-50 ring-2 ring-gold-500' : 'ring-black/10'} ${o.available ? '' : 'cursor-not-allowed opacity-50'}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="opt" disabled={!o.available} checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="h-5 w-5 accent-brand-600" />
                  <span className="font-medium">{o.label || 'Padrão'}</span>
                </span>
                <span className="text-sm font-semibold">{o.available ? brl(o.priceCents ?? p.promoPriceCents ?? p.priceCents) : 'Indisponível'}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="mt-4 block">
        <span className="label">Observações</span>
        <textarea className="input min-h-20" maxLength={300} placeholder="Ex.: bem passado, sem gelo..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </Modal>
  );
}

/** Montagem do combo: o cliente distribui livremente os sabores e escolhe os refrigerantes. */
export function ComboBuilder({ combo, onClose }: { combo: Combo | null; onClose: () => void }) {
  const { menu } = useStore();
  const cart = useCart();
  const toast = useToast();
  const [pastels, setPastels] = useState<Record<string, number>>({});
  const [drinks, setDrinks] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');

  const pastelProducts = useMemo(() => (menu?.products ?? []).filter((p) => p.kind === 'PASTEL'), [menu]);
  const drinkChoices = useMemo(
    () =>
      (menu?.products ?? [])
        .filter((p) => p.kind === 'DRINK')
        .flatMap((p) =>
          p.options.length
            ? p.options.map((o) => ({ key: `${p.id}:${o.id}`, productId: p.id, optionId: o.id as string | null, name: o.label ? `${p.name} (${o.label})` : p.name, available: p.available && o.available }))
            : [{ key: `${p.id}:`, productId: p.id, optionId: null as string | null, name: p.name, available: p.available }],
        ),
    [menu],
  );
  if (!combo) return null;
  if (!menu) return <Spinner />;

  const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
  const pCount = sum(pastels);
  const dCount = sum(drinks);
  const ready = pCount === combo.pastelQty && dCount === combo.drinkQty;

  const add = () => {
    const pSel: Selection[] = Object.entries(pastels).filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity }));
    const dSel: Selection[] = Object.entries(drinks)
      .filter(([, q]) => q > 0)
      .map(([key, quantity]) => {
        const [productId, optionId] = key.split(':');
        return { productId, optionId: optionId || null, quantity };
      });
    const names = (sel: Selection[], list: { id?: string; key?: string; name: string }[], isDrink: boolean) =>
      sel.map((s) => `${s.quantity}x ${list.find((x) => (isDrink ? x.key === `${s.productId}:${s.optionId ?? ''}` : x.id === s.productId))?.name ?? ''}`);
    cart.add({
      input: { type: 'combo', comboId: combo.id, quantity: 1, pastels: pSel, drinks: dSel, notes: notes.trim() || null },
      name: combo.name,
      description: [...names(pSel, pastelProducts, false), ...names(dSel, drinkChoices, true)].join(', '),
      unitPriceCents: combo.priceCents,
      imageUrl: combo.imageUrl,
    });
    toast(`${combo.name} adicionado ao carrinho`);
    setPastels({});
    setDrinks({});
    setNotes('');
    onClose();
  };

  const counter = (cur: number, total: number) => (
    <span className={`chip ${cur === total ? 'bg-green-100 text-green-800' : 'bg-gold-100 text-gold-700'}`}>
      {cur}/{total}
    </span>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="text-gold-500" /> {combo.name}
        </span>
      }
      footer={
        <button className="btn-primary w-full" disabled={!ready} onClick={add}>
          {ready ? `Adicionar ao carrinho · ${brl(combo.priceCents)}` : `Escolha ${combo.pastelQty - pCount > 0 ? `${combo.pastelQty - pCount} pastel(éis)` : ''}${combo.pastelQty - pCount > 0 && combo.drinkQty - dCount > 0 ? ' e ' : ''}${combo.drinkQty - dCount > 0 ? `${combo.drinkQty - dCount} refrigerante(s)` : ''}`}
        </button>
      }
    >
      <p className="text-ink-700">{combo.description}</p>
      {combo.savingsCents > 0 && (
        <p className="mt-2 rounded-2xl bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700">
          Comprando separado sairia {brl(combo.regularCents)} — você economiza {brl(combo.savingsCents)}!
        </p>
      )}
      {combo.pastelQty > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-bold">Sabores dos pastéis</h3>
            {counter(pCount, combo.pastelQty)}
          </div>
          <div className="grid gap-2">
            {pastelProducts.map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-3 rounded-2xl p-2 ring-1 ring-black/10 ${p.available ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-3">
                  <img src={productImage(p)} alt="" className="h-12 w-12 rounded-xl object-cover" />
                  <span className="font-semibold">{p.name}</span>
                  {!p.available && <span className="chip bg-black/10">Indisponível</span>}
                </div>
                {p.available && (
                  <QtyStepper size="sm" value={pastels[p.id] ?? 0} max={(pastels[p.id] ?? 0) + combo.pastelQty - pCount} onChange={(v) => setPastels((s) => ({ ...s, [p.id]: v }))} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {combo.drinkQty > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-bold">Refrigerantes</h3>
            {counter(dCount, combo.drinkQty)}
          </div>
          <div className="grid gap-2">
            {drinkChoices.map((d) => (
              <div key={d.key} className={`flex items-center justify-between gap-3 rounded-2xl p-3 ring-1 ring-black/10 ${d.available ? '' : 'opacity-50'}`}>
                <span className="font-semibold">{d.name}</span>
                {d.available ? (
                  <QtyStepper size="sm" value={drinks[d.key] ?? 0} max={(drinks[d.key] ?? 0) + combo.drinkQty - dCount} onChange={(v) => setDrinks((s) => ({ ...s, [d.key]: v }))} />
                ) : (
                  <span className="chip bg-black/10">Indisponível</span>
                )}
              </div>
            ))}
            {!drinkChoices.length && <p className="text-sm text-brand-700">Nenhum refrigerante disponível no momento.</p>}
          </div>
        </section>
      )}
      <label className="mt-5 block">
        <span className="label">Observações</span>
        <textarea className="input min-h-16" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Algum pedido especial?" />
      </label>
    </Modal>
  );
}

/** Cardápio completo: combos em destaque + produtos por categoria. */
export function MenuView({ allowFavorites = true }: { allowFavorites?: boolean }) {
  const { menu, error } = useStore();
  const { customer } = useCustomer();
  const toast = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [combo, setCombo] = useState<Combo | null>(null);
  const [favorites, setFavorites] = useState<string[] | null>(null);
  const [cat, setCat] = useState<string>('combos');

  useEffect(() => {
    if (customer && allowFavorites) api<string[]>('/customer/favorites').then(setFavorites).catch(() => setFavorites([]));
    else setFavorites(null);
  }, [customer, allowFavorites]);

  if (error && !menu) return <p className="p-6 text-center text-brand-700">{error}</p>;
  if (!menu) return <Spinner label="Carregando cardápio..." />;

  const toggleFav = async (id: string) => {
    if (!favorites) return;
    const isFav = favorites.includes(id);
    setFavorites(isFav ? favorites.filter((f) => f !== id) : [...favorites, id]);
    try {
      await api(`/customer/favorites/${id}`, { method: isFav ? 'DELETE' : 'PUT', body: {} });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const tabs = [
    { id: 'combos', name: '🔥 Combos' },
    ...(favorites?.length ? [{ id: 'favs', name: '❤️ Favoritos' }] : []),
    ...menu.categories.filter((c) => menu.products.some((p) => p.categoryId === c.id)).map((c) => ({ id: c.id, name: c.name })),
  ];
  const scrollTo = (id: string) => {
    setCat(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <nav className="sticky top-[60px] z-20 -mx-4 mb-4 flex gap-2 overflow-x-auto bg-gold-50/95 px-4 py-2 backdrop-blur">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => scrollTo(t.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${cat === t.id ? 'bg-brand-600 text-white' : 'bg-white text-ink-800 ring-1 ring-black/10'}`}>
            {t.name}
          </button>
        ))}
      </nav>

      {menu.combos.length > 0 && (
        <section id="sec-combos" className="scroll-mt-32">
          <h2 className="mb-1 text-3xl font-extrabold">Combos promocionais</h2>
          <p className="mb-4 text-ink-700">Preço fechado, sabores à sua escolha. O desconto já está no preço!</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {menu.combos.map((c) => (
              <ComboCard key={c.id} c={c} onOpen={() => setCombo(c)} />
            ))}
          </div>
        </section>
      )}

      {favorites && favorites.length > 0 && (
        <section id="sec-favs" className="mt-8 scroll-mt-32">
          <h2 className="mb-3 text-2xl font-extrabold">Seus favoritos</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {menu.products.filter((p) => favorites.includes(p.id)).map((p) => (
              <ProductCard key={p.id} p={p} onOpen={() => setProduct(p)} favorite onToggleFavorite={() => toggleFav(p.id)} />
            ))}
          </div>
        </section>
      )}

      {menu.categories.map((c) => {
        const items = menu.products.filter((p) => p.categoryId === c.id);
        if (!items.length) return null;
        return (
          <section key={c.id} id={`sec-${c.id}`} className="mt-8 scroll-mt-32">
            <h2 className="mb-3 text-2xl font-extrabold">{c.name}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((p) => (
                <ProductCard key={p.id} p={p} onOpen={() => setProduct(p)} favorite={favorites?.includes(p.id)} onToggleFavorite={favorites ? () => toggleFav(p.id) : undefined} />
              ))}
            </div>
          </section>
        );
      })}

      {product && <ProductModal product={product} onClose={() => setProduct(null)} />}
      {combo && <ComboBuilder combo={combo} onClose={() => setCombo(null)} />}
    </div>
  );
}
