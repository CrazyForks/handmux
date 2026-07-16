// web/src/components/ChatView.jsx
// The 对话 lens: a read-projection of the pane's Claude session as IM bubbles + two-type gate cards
// (permission / AskUserQuestion). NO input of its own — text is typed in the existing BottomDock composer
// (which stays mounted below in chat lens). Gate buttons write via the SAME send-keys the terminal uses.
import { useState } from 'react';
import { useTranscript } from '../hooks/useTranscript.js';
import { pendingGate } from '../chatGate.js';
import { sendKeys } from '../api.js';

// One-line summary for a collapsed tool chip. Cover the high-frequency tools; generic fallback otherwise.
function toolSummary(tool) {
  const n = tool.name || '工具';
  const inp = tool.input || {};
  if (n === 'Bash') return `▶ 运行命令: ${inp.command || ''}`.trim();
  if (n === 'Edit' || n === 'Write') return `✎ ${n === 'Write' ? '写入' : '编辑'} ${inp.file_path || ''}`.trim();
  if (n === 'Read') return `📄 读取 ${inp.file_path || ''}`.trim();
  return `🔧 ${n}`;
}

function ToolChip({ tool }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'chat-tool' + (tool.isError ? ' chat-tool-err' : '')}>
      <button type="button" className="chat-tool-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {toolSummary(tool)}
      </button>
      {open && tool.result != null && <pre className="chat-tool-body">{tool.result}</pre>}
    </div>
  );
}

function Bubble({ m }) {
  if (m.type === 'tool') return <ToolChip tool={m.tool} />;
  if (m.type === 'thinking') return <div className="chat-thinking">{m.text}</div>;
  return <div className={'chat-bubble ' + (m.role === 'user' ? 'chat-me' : 'chat-them')}>{m.text}</div>;
}

export default function ChatView({ pane, kind }) {
  const messages = useTranscript(pane, true);
  const gate = pendingGate(messages, kind);
  const isPlanGate = kind === 'permission' && !gate; // permission 但被 pendingGate 排除（如 ExitPlanMode）

  return (
    <div className="chat-view">
      <div className="chat-scroll">
        {messages.length === 0 && <div className="chat-empty">还没有对话内容</div>}
        {messages.map((m, idx) => <Bubble key={m.i + ':' + idx} m={m} />)}
      </div>

      {gate && (
        <div className="chat-gate">
          <div className="chat-gate-prompt">{gate.prompt}</div>
          <div className="chat-gate-actions">
            {gate.options.map((o, i) => (
              <button key={i} type="button" className="chat-gate-btn" onClick={() => sendKeys(pane, o.keys)}>{o.label}</button>
            ))}
          </div>
        </div>
      )}
      {isPlanGate && <div className="chat-gate chat-gate-hint">这一步需要在终端里处理，点右上「终端」切换。</div>}
    </div>
  );
}
// 输入不在此处：chat 镜头下底部照常是 BottomDock composer（Task 7 保证其常驻），门卡片悬在气泡流末尾、composer 之上。
