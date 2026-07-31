import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { ChatDTO } from '@popy/shared';
import { t } from '../i18n';
import { relativeTime } from '../lib/time';
import { useChatStore } from '../store/chat';
import { Button } from '../ui/controls';

/** The conversation list: the sidebar on a wide screen, the home on a phone. */
export function ChatList() {
  const navigate = useNavigate();
  const chats = useChatStore((state) => state.chats);
  const archived = useChatStore((state) => state.archived);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadArchived = useChatStore((state) => state.loadArchived);
  const createChat = useChatStore((state) => state.createChat);

  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadChats();
    void loadArchived();
  }, [loadChats, loadArchived]);

  const visible = chats.filter((chat) =>
    `${chat.title} ${chat.preview}`.toLowerCase().includes(filter.toLowerCase()),
  );

  async function startChat(): Promise<void> {
    setCreating(true);
    try {
      const chat = await createChat();
      navigate(`/chat/${chat.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-3">
        <span className="font-semibold">{t('app.name')}</span>
        <button
          type="button"
          data-testid="shell-settings"
          aria-label={t('shell.settings')}
          onClick={() => navigate('/settings')}
          className="rounded-md p-2 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          <GearIcon />
        </button>
      </header>

      <div className="flex flex-col gap-2 p-3">
        <Button type="button" data-testid="shell-new-chat" disabled={creating} onClick={() => void startChat()}>
          {t('shell.newChat')}
        </Button>
        <input
          data-testid="chat-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('shell.filter')}
          aria-label={t('shell.filter')}
          className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t('shell.noChats')}</p>
        ) : (
          <ul data-testid="chat-list">
            {visible.map((chat) => (
              <ChatRow key={chat.id} chat={chat} />
            ))}
          </ul>
        )}

        {archived.length > 0 ? (
          <div className="border-t border-[var(--border)]">
            <button
              type="button"
              data-testid="archived-toggle"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((value) => !value)}
              className="w-full px-4 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
            >
              {showArchived ? '▾' : '▸'} {t('shell.archived', { count: archived.length })}
            </button>
            {showArchived ? (
              <ul data-testid="archived-list">
                {archived.map((chat) => (
                  <ChatRow key={chat.id} chat={chat} archived />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function ChatRow({ chat, archived = false }: { chat: ChatDTO; archived?: boolean }) {
  const rename = useChatStore((state) => state.rename);
  const setArchived = useChatStore((state) => state.setArchived);
  const remove = useChatStore((state) => state.remove);
  const live = useChatStore((state) => state.live[chat.id]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  async function commitRename(): Promise<void> {
    setEditing(false);
    if (draft.trim() !== chat.title) await rename(chat.id, draft);
  }

  if (editing) {
    return (
      <li className="px-3 py-2">
        <input
          autoFocus
          data-testid="chat-rename-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitRename();
            if (event.key === 'Escape') {
              setDraft(chat.title);
              setEditing(false);
            }
          }}
          className="w-full rounded border border-[var(--accent)] bg-[var(--input-bg)] px-2 py-1 text-sm outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <NavLink
        to={`/chat/${chat.id}`}
        data-testid="chat-row"
        className={({ isActive }) =>
          `flex flex-col gap-0.5 px-4 py-3 ${isActive ? 'bg-[var(--hover-overlay)]' : 'hover:bg-[var(--hover-overlay)]'}`
        }
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{chat.title}</span>
          <span className="shrink-0 text-xs text-[var(--muted)]">{relativeTime(chat.updatedAt)}</span>
        </div>
        <span className="truncate text-xs text-[var(--muted)]">
          {live !== undefined ? t('chat.answering') : chat.preview}
        </span>
      </NavLink>

      {/*
        A visible button rather than long-press: on a touch screen a hidden
        gesture has no affordance and fights the scroll, and on a pointer
        screen hover-only controls are invisible to keyboards.
      */}
      <button
        type="button"
        data-testid="chat-menu"
        aria-label={t('shell.chatMenu')}
        onClick={() => setMenuOpen((value) => !value)}
        className="absolute top-2 right-1 rounded px-2 py-1 text-[var(--muted)] opacity-100 hover:bg-[var(--hover-overlay)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        ⋯
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute top-8 right-2 z-10 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
        >
          <MenuItem
            testId="chat-rename"
            label={t('shell.rename')}
            onClick={() => {
              setMenuOpen(false);
              setDraft(chat.title);
              setEditing(true);
            }}
          />
          <MenuItem
            testId="chat-archive"
            label={archived ? t('shell.unarchive') : t('shell.archive')}
            onClick={() => {
              setMenuOpen(false);
              void setArchived(chat.id, !archived);
            }}
          />
          <MenuItem
            testId="chat-delete"
            label={t('shell.delete')}
            danger
            onClick={() => {
              setMenuOpen(false);
              if (window.confirm(t('shell.deleteConfirm', { title: chat.title }))) {
                void remove(chat.id);
              }
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

function MenuItem({
  label,
  onClick,
  testId,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-1.5 text-left whitespace-nowrap hover:bg-[var(--hover-overlay)] ${
        danger ? 'text-[var(--danger)]' : ''
      }`}
    >
      {label}
    </button>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.6-.25 1-.83 1-1.51V3a2 2 0 1 1 4 0v.09c0 .68.4 1.26 1 1.51.6.25 1.3.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.25.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.26.4-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
