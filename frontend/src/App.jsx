import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Analytics from './components/Analytics';

const Landing    = lazy(() => import('./pages/Landing'));
const Login      = lazy(() => import('./pages/Login'));
const Register   = lazy(() => import('./pages/Register'));
const Lists      = lazy(() => import('./pages/Lists'));
const ListDetail = lazy(() => import('./pages/ListDetail'));
const Quiz       = lazy(() => import('./pages/Quiz'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const Results    = lazy(() => import('./pages/Results'));

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="container"><p>Laddar…</p></div>;
  }

  return (
    <Suspense fallback={<div className="container"><p>Laddar…</p></div>}>
      <Routes>
        <Route path="/login"    element={user ? <Navigate to="/lists" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/lists" replace /> : <Register />} />

        <Route path="/" element={user ? <Navigate to="/lists" replace /> : <Landing />} />

        <Route
          path="/lists"
          element={
            <ProtectedRoute>
              <Layout><Lists /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id"
          element={
            <ProtectedRoute>
              <Layout><ListDetail /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/quiz"
          element={
            <ProtectedRoute>
              <Layout><Quiz /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/flashcards"
          element={
            <ProtectedRoute>
              <Layout><Flashcards /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists/:id/results"
          element={
            <ProtectedRoute>
              <Layout><Results /></Layout>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to={user ? '/lists' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Analytics />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
