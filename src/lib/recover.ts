// 화면이 안 뜰 때 복구: 앱 파일 캐시(서비스워커)만 지우고 다시 받는다. 입력한 데이터(IndexedDB)는 그대로.
export async function reloadFresh() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // 지우기 실패해도 새로 고침은 한다
  }
  location.replace(location.pathname + '?r=' + Date.now());
}
