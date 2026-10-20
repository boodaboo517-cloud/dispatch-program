let gen: () => string = () => crypto.randomUUID();

export const newId = () => gen();

/** 테스트용: 결정적인 id 생성기로 교체 */
export function setIdGenerator(fn: () => string) {
  gen = fn;
}
