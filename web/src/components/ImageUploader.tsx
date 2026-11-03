import { useCallback, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/context';
import { Modal } from './ui';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif';

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Não foi possível ler a imagem. Tente outro formato (JPG ou PNG).'));
    i.src = src;
  });
  const scale = Math.min(1, 1600 / Math.max(area.width, area.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  canvas.getContext('2d')!.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao recortar'))), 'image/jpeg', 0.9));
}

/**
 * Upload de foto: galeria, câmera (celular) ou computador → prévia → recorte → envio.
 * O servidor valida o conteúdo, converte para WebP e grava no armazenamento persistente.
 */
export function ImageUploader({ currentUrl, uploadPath, deletePath, onChange, aspect = 4 / 3 }: { currentUrl: string | null; uploadPath: string; deletePath?: string; onChange: (url: string | null) => void; aspect?: number }) {
  const toast = useToast();
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecione um arquivo de imagem.', 'error');
    if (file.size > MAX_BYTES * 2) return toast('Imagem muito grande (máx. 16 MB antes do recorte).', 'error');
    setSrc(URL.createObjectURL(file));
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };

  const upload = async () => {
    if (!src || !area) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(src, area);
      if (blob.size > MAX_BYTES) throw new Error('A imagem recortada passou de 8 MB.');
      const form = new FormData();
      form.append('image', blob, 'foto.jpg');
      const r = await api<{ url: string }>(uploadPath, { form });
      onChange(r.url);
      toast('Foto atualizada!');
      URL.revokeObjectURL(src);
      setSrc(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deletePath || !window.confirm('Remover a foto?')) return;
    try {
      await api(deletePath, { method: 'DELETE' });
      onChange(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const onCropComplete = useCallback((_: Area, px: Area) => setArea(px), []);

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="h-24 w-32 overflow-hidden rounded-2xl bg-gold-100 ring-1 ring-black/10">
          {currentUrl ? <img src={currentUrl} alt="Foto atual" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-black/40">Sem foto</div>}
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" className="btn-ghost btn-sm" onClick={() => gallery.current?.click()}>
            <ImagePlus size={16} /> {currentUrl ? 'Substituir' : 'Escolher foto'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => camera.current?.click()}>
            <Camera size={16} /> Tirar foto
          </button>
          {currentUrl && deletePath && (
            <button type="button" className="btn-danger btn-sm" onClick={remove}>
              <Trash2 size={16} /> Excluir
            </button>
          )}
        </div>
      </div>
      <input ref={gallery} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />

      {src && (
        <Modal open onClose={() => setSrc(null)} title="Recortar foto" footer={<button className="btn-primary w-full" disabled={busy} onClick={upload}>{busy ? 'Enviando...' : 'Salvar foto'}</button>}>
          <div className="relative h-72 overflow-hidden rounded-2xl bg-black sm:h-96">
            <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
          </div>
          <label className="mt-3 block text-sm font-semibold">
            Zoom
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-brand-600" />
          </label>
        </Modal>
      )}
    </div>
  );
}
