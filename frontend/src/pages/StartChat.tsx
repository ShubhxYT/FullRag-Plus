import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { newConversation } from '../lib/chatStore';

/**
 * /results?q=... (used by the home search and old links): start a new
 * conversation with that question and open it at /chat/:id.
 */
export default function StartChat() {
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (!q || started.current) return;
    started.current = true;
    const id = newConversation(q);
    navigate(`/chat/${id}`, { replace: true });
  }, [q, navigate]);

  if (!q) return <Navigate to="/" replace />;
  return null;
}
