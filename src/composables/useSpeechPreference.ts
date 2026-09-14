import { ref } from 'vue'

/**
 * 语音核读开关的用户偏好。
 *
 * 只持久化“开/关”这一项，跨轮次与重新开始保留；待播语音内容由组件在
 * 卸载（轮次切换）时取消并随组件实例销毁，绝不落盘、不进入第二轮。
 * localStorage 不可用（隐私模式 / 测试环境）时退回会话内默认值。
 */
const STORAGE_KEY = 'double-entry:speech-review'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // 持久化失败不影响本会话内的开关状态。
  }
}

/** 单例偏好：两次挂载（两轮）读到同一开关，重启应用后仍尽量保留。 */
const speechReviewEnabled = ref<boolean>(readStored())

export function useSpeechPreference() {
  function setSpeechReviewEnabled(value: boolean): void {
    speechReviewEnabled.value = value
    writeStored(value)
  }

  return { speechReviewEnabled, setSpeechReviewEnabled }
}
