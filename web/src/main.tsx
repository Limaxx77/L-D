import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { CartProvider, CustomerProvider, StoreProvider, ToastProvider } from './lib/context';
import { PublicLayout } from './components/layout';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import { MenuPage, NotFound, Privacy } from './pages/Misc';

const Cart = lazy(() => import('./pages/Cart'));
const Track = lazy(() => import('./pages/Track'));
const Account = lazy(() => import('./pages/Account'));
const TablePage = lazy(() => import('./pages/Table'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <StoreProvider>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="/mesa/:token" element={<TablePage />} />
              <Route
                element={
                  <CustomerProvider>
                    <CartProvider storageKey="ld-cart">
                      <PublicLayout />
                    </CartProvider>
                  </CustomerProvider>
                }
              >
                <Route index element={<Home />} />
                <Route path="cardapio" element={<MenuPage />} />
                <Route path="carrinho" element={<Cart />} />
                <Route path="pedido/:token" element={<Track />} />
                <Route path="conta" element={<Account />} />
                <Route path="privacidade" element={<Privacy />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </StoreProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
