const DATA_FILES = ['/data/iast.txt', '/data/devanagari.txt', '/data/malayalam.txt'];

const lines: Record<string, string[]> = {};

async function loadData() {
  for (const file of DATA_FILES) {
    const res = await fetch(file);
    const text = await res.text();
    lines[file] = text.split('\n').filter(l => l.trim().length > 0);
  }
}

function getRandomName(): string {
  const available = DATA_FILES.filter(f => lines[f]?.length > 0);
  if (available.length === 0) return '';
  const file = available[Math.floor(Math.random() * available.length)];
  return lines[file][Math.floor(Math.random() * lines[file].length)];
}

export async function initTabMantra() {
  await loadData();

  const originalTitle = document.title;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const name = getRandomName();
      if (name) document.title = name;
    } else {
      document.title = originalTitle;
    }
  });
}
