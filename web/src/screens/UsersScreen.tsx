import { useState } from 'react';
import type { Role, UserAccount } from '../api/client.ts';
import { useUserMutations, useUsers } from '../api/hooks.ts';
import { ConfirmDialog, Modal } from '../components/Modal.tsx';
import { RecordForm, type Field } from '../components/RecordForm.tsx';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * WP §7.2 — account management, admin only. Answers client feedback round 2 #5
 * ("how do we add users, e.g. Roi and the other field managers?"): the backend
 * (routes/users.ts, api.users, useUserMutations) already existed; this is the
 * interface for it.
 *
 * Passwords are never read back from the server, so create takes a password and
 * edit does not — a password change is a separate, explicit action. The server
 * is the guard for the dangerous cases (last admin, self-deactivate); anything
 * it refuses comes back as a toast rather than being pre-judged here.
 */
const ROLE_LABEL: Record<Role, StringKey> = {
  reporter: 'role.reporter',
  manager: 'role.manager',
  admin: 'role.admin',
};

export function UsersScreen() {
  const t = useT();
  const toast = useToast();
  const users = useUsers();
  const mut = useUserMutations();

  const [editing, setEditing] = useState<UserAccount | null | undefined>(undefined);
  // undefined = closed, null = adding, UserAccount = editing.
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [deleting, setDeleting] = useState<UserAccount | null>(null);

  const roleOptions = (['reporter', 'manager', 'admin'] as const).map((r) => ({
    value: r,
    label: t(ROLE_LABEL[r]),
  }));

  const createFields: Field[] = [
    { key: 'username', label: t('field.user.username'), required: true, hint: t('field.user.usernameHint') },
    { key: 'password', label: t('field.user.password'), type: 'password', required: true, hint: t('field.user.passwordHint') },
    { key: 'display_name', label: t('field.user.displayName'), required: true },
    { key: 'role', label: t('field.user.role'), type: 'select', options: roleOptions },
    { key: 'emp_num', label: t('field.user.empNum'), type: 'number', hint: t('field.user.empNumHint') },
    { key: 'active', label: t('field.user.active'), type: 'bool' },
  ];
  // No username (immutable) and no password (its own action) when editing.
  const editFields: Field[] = [
    { key: 'display_name', label: t('field.user.displayName'), required: true },
    { key: 'role', label: t('field.user.role'), type: 'select', options: roleOptions },
    { key: 'emp_num', label: t('field.user.empNum'), type: 'number', hint: t('field.user.empNumHint') },
    { key: 'active', label: t('field.user.active'), type: 'bool' },
  ];

  const save = async (values: Record<string, unknown>) => {
    if (editing) {
      await mut.update.mutateAsync({ id: editing.id, ...values });
      toast.show(t('common.saved'));
    } else {
      // role's select carries an empty "none" option; a new account defaults to
      // the least-privileged role rather than sending a null the server rejects.
      const role = values.role ? values.role : 'reporter';
      await mut.create.mutateAsync({ ...values, role });
      toast.show(t('common.added'));
    }
    setEditing(undefined);
  };

  const resetPassword = async (values: Record<string, unknown>) => {
    if (!resetting) return;
    await mut.setPassword.mutateAsync({ id: resetting.id, password: String(values.password ?? '') });
    toast.show(t('users.passwordReset'));
    setResetting(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await mut.remove.mutateAsync(deleting.id);
      toast.show(t('common.deleted'));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t('common.deleteFailed'), 'error');
    }
    setDeleting(null);
  };

  const fmtLogin = (iso: string | null) => {
    if (!iso) return t('users.never');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>
              {t('users.title')} {users.data && <span className="mini">({users.data.length})</span>}
            </div>
            <div className="mini">{t('users.subtitle')}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn sm grn" onClick={() => setEditing(null)}>
            ＋ {t('users.add')}
          </button>
        </div>

        {users.isLoading ? (
          <div className="empty">{t('common.loading')}</div>
        ) : users.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {users.error instanceof Error ? users.error.message : t('common.failedToLoad')}
          </div>
        ) : (users.data?.length ?? 0) === 0 ? (
          <div className="empty">{t('users.none')}</div>
        ) : (
          <div className="xl-scroll">
            <table className="xl" style={{ fontSize: 12.5, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>{t('th.username')}</th>
                  <th style={{ textAlign: 'start' }}>{t('th.displayName')}</th>
                  <th>{t('th.role')}</th>
                  <th>{t('th.linkedEmployee')}</th>
                  <th>{t('th.status')}</th>
                  <th>{t('th.lastLogin')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(users.data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="derived" style={{ textAlign: 'start' }}>
                      <span dir="ltr">{u.username}</span>
                    </td>
                    <td className="derived" style={{ textAlign: 'start' }}>
                      {u.display_name}
                    </td>
                    <td className="derived">{t(ROLE_LABEL[u.role])}</td>
                    <td className="derived">{u.emp_num ?? '—'}</td>
                    <td className="derived">
                      <span className={`pill ${u.active ? 'g' : 'y'}`}>
                        {u.active ? t('users.active') : t('users.inactive')}
                      </span>
                    </td>
                    <td className="derived">
                      <span dir="ltr">{fmtLogin(u.last_login_at)}</span>
                    </td>
                    <td className="actcell" style={{ whiteSpace: 'nowrap' }}>
                      <button className="delm" style={{ color: '#2e5496' }} title={t('common.edit')} onClick={() => setEditing(u)}>
                        ✏️
                      </button>
                      <button className="delm" title={t('users.resetPassword')} onClick={() => setResetting(u)}>
                        🔑
                      </button>
                      <button className="delm" title={t('common.delete')} onClick={() => setDeleting(u)}>
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== undefined && (
        <Modal
          title={editing ? t('users.editTitle', { name: editing.display_name }) : t('users.addTitle')}
          onClose={() => setEditing(undefined)}
        >
          <RecordForm
            fields={editing ? editFields : createFields}
            record={(editing ?? null) as Record<string, unknown> | null}
            submitLabel={editing ? t('common.save') : t('common.add')}
            onCancel={() => setEditing(undefined)}
            onSubmit={save}
          />
        </Modal>
      )}

      {resetting && (
        <Modal title={t('users.resetTitle', { name: resetting.display_name })} onClose={() => setResetting(null)}>
          <RecordForm
            fields={[
              { key: 'password', label: t('users.newPassword'), type: 'password', required: true, hint: t('field.user.passwordHint') },
            ]}
            record={null}
            submitLabel={t('users.resetPassword')}
            onCancel={() => setResetting(null)}
            onSubmit={resetPassword}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={t('users.deleteConfirm', { name: `${deleting.display_name} (${deleting.username})` })}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          busy={mut.remove.isPending}
        />
      )}

      {toast.node}
    </>
  );
}
