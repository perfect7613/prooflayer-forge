export const DEMO_PAPER = {
  id: "grokking-ridge",
  title: "To Grok Grokking: Provable Grokking in Ridge Regression",
  url: "https://arxiv.org/html/2601.19791v1",
  referenceLogbook:
    "https://huggingface.co/spaces/amkkk/grok-ridge-regression-repro",
  brief: `Independently implement the linear ridge-regression experiment in Section 5.1 from the paper. No repository is required. Read the source before writing code. Focus on delayed generalization and the effect of weight decay. Start with the stated n=100, m=1000, eta=1, initialization variance=1, lambda=1e-4, thresholds=0.01. Match the loss normalization and update equation exactly. Use multiple fixed seeds; report seed count and every deviation. Validate any spectral acceleration against direct gradient descent. Include a no-weight-decay control. Do not claim to reproduce neural-network experiments or prove general theorems. Request human approval of the experiment protocol before running generated code.`,
};
export type ReproductionMode = "from_paper" | "repository";
