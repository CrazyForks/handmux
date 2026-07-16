// A two-segment lens switch — 终端 (left) / 对话 (right). Button group + aria-pressed (project rule: no
// native <select>). Rendered by App ONLY for agent panes; a non-agent pane shows no switch at all.
export default function LensSwitch({ value, onChange }) {
  const seg = (key, label) => (
    <button type="button" key={key} className="lens-seg" aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>
  );
  return <div className="lens-switch" role="group" aria-label="视图切换">{seg('terminal', '终端')}{seg('chat', '对话')}</div>;
}
