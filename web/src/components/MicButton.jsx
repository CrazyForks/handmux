import { MicIcon } from './icons.jsx';
import { t } from '../i18n';

// 内嵌在输入框右内侧的点按麦克风(微信式)。灰色 = 待命,绿色(.on)= 正在听。一点开始听写、再点停止。
// `disabled` 用于请求麦克风权限期间,防重复触发。纯受控,无内部状态。
export default function MicButton({ active, disabled, onToggle }) {
  return (
    <button
      type="button"
      className={`input-mic${active ? ' on' : ''}`}
      aria-label={active ? t('mic.stop') : t('mic.start')}
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
    >
      <MicIcon />
    </button>
  );
}
