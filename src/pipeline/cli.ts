const cmd = process.argv[2];

async function main() {
  switch (cmd) {
    case 'verify-curriculum': {
      const { verifyCurriculumCli } = await import('./cli-curriculum.ts');
      return verifyCurriculumCli();
    }
    default:
      console.error('Comandi: verify-curriculum');
      process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
