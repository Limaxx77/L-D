import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

/**
 * Conexão em tempo real. O WebSocket conecta direto ao backend (VITE_SOCKET_URL),
 * pois rewrites da Vercel não encaminham WebSockets.
 */
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;

type Auth = { staffToken?: string; orderToken?: string; participantToken?: string };

export function useSocket(
  getAuth: (() => Promise<Auth | null>) | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (payload: any) => void>,
  deps: unknown[] = [],
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!getAuth) return;
    let socket: Socket | null = null;
    let cancelled = false;
    (async () => {
      const auth = await getAuth().catch(() => null);
      if (cancelled || !auth) return;
      socket = io(SOCKET_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: (cb) => {
          // Renova o token a cada reconexão
          getAuth().then((a) => cb(a ?? {})).catch(() => cb({}));
        },
        reconnectionDelayMax: 10_000,
      });
      for (const event of Object.keys(handlersRef.current)) {
        socket.on(event, (payload: any) => handlersRef.current[event]?.(payload as never));
      }
      socket.on('connect', () => handlersRef.current['$connect']?.(undefined as never));
      socket.on('disconnect', () => handlersRef.current['$disconnect']?.(undefined as never));
    })();
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
