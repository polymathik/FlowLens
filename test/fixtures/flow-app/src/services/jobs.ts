import { sendMail, renderReport, defaultStep } from './job-steps.js';

export class Job {
  run() {
    return this.step();
  }
  step() {
    return defaultStep();
  }
}

export class EmailJob extends Job {
  step() {
    return sendMail();
  }
}

export class ReportJob extends Job {
  step() {
    return renderReport();
  }
}
