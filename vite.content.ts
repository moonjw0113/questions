import { readFileSync } from 'node:fs';
// 웹앱과 커넥터 서버가 함께 쓰는 스키마·예제·프롬프트 (virtual:study-content)
export const embeddedContent = {
  name: 'chagok-content',
  resolveId(id: string) {
    if (id === 'virtual:study-content') return '\0chagok-content';
  },
  load(id: string) {
    if (id !== '\0chagok-content') return;
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    return `export const schema=${read('public/question-bank.schema.json')};export const schema11=${read('public/question-bank.v1.1.schema.json')};export const biology=${read('public/examples/biology.json')};export const generationPrompt=${JSON.stringify(read('public/prompts/generate.txt'))};export const analysisPrompt=${JSON.stringify(read('public/prompts/analyze.txt'))};`;
  },
};
