import { useState } from 'react';
import { setToken } from '../storage.js';
import { t } from '../i18n';

export default function TokenPrompt({ onSaved }) {
  const [value, setValue] = useState('');
  const save = (e) => {
    e.preventDefault();
    const tok = value.trim();
    if (!tok) return;
    setToken(tok);
    onSaved();
  };
  return (
    <form className="token-prompt" onSubmit={save}>
      <h2>{t('token.title')}</h2>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('token.placeholder')} />
      <button type="submit">{t('common.save')}</button>
    </form>
  );
}
