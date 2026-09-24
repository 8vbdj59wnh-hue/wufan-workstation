import express from 'express';
import { exec } from 'child_process';

console.error(
  'Deprecated: GitHub webhooks are not part of the release workflow. ' +
  'Use scripts/release-package.sh and scripts/release-from-package.sh.',
);
process.exit(1);

const app = express();
const port = Number(process.env.WEBHOOK_PORT || 9000);
const deployScript = `${process.env.WUFAN_PROJECT_DIR || ""}/scripts/deploy.sh`;

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('GitHub push detected');

  exec(`bash ${deployScript}`, (error, stdout, stderr) => {
    if (error) {
      console.error('deploy failed:', error);
      if (stderr) {
        console.error(stderr);
      }
      return;
    }

    if (stderr) {
      console.error(stderr);
    }
    console.log('deploy success:', stdout);
  });

  res.send('OK');
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Webhook server running on port ${port}`);
});
