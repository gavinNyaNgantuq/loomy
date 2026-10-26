import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Sidebar } from './components/Sidebar.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { Products } from './pages/Products.js';
import { Materials } from './pages/Materials.js';
import { Suppliers } from './pages/Suppliers.js';
import { Customers } from './pages/Customers.js';
import { Users } from './pages/Users.js';
import type { JSX, ReactNode } from 'react';

function Guard({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6">Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user?.role ?? '-'} onLogout={logout} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Guard>
                <Shell>
                  <Dashboard />
                </Shell>
              </Guard>
            }
          />
          <Route
            path="/products"
            element={
              <Guard>
                <Shell>
                  <Products />
                </Shell>
              </Guard>
            }
          />
          <Route
            path="/materials"
            element={
              <Guard>
                <Shell>
                  <Materials />
                </Shell>
              </Guard>
            }
          />
          <Route
            path="/suppliers"
            element={
              <Guard>
                <Shell>
                  <Suppliers />
                </Shell>
              </Guard>
            }
          />
          <Route
            path="/customers"
            element={
              <Guard>
                <Shell>
                  <Customers />
                </Shell>
              </Guard>
            }
          />
          <Route
            path="/users"
            element={
              <Guard>
                <Shell>
                  <Users />
                </Shell>
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
