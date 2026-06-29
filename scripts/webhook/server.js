import express from 'express';
import { exec } from 'child_process';

const app = express();
const port = Number(process.env.WEBHOOK_PORT || 9000);
const deployScript = '/Users/meiyounaichatouyuna/Projects/goal-execution-system/scripts/deploy.sh';

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
