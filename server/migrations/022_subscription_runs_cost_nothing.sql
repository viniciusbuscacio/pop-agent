-- A subscription run costs nothing (decision of 03/08).
--
-- pi reports a `cost` for every run: tokens times the model's catalogue price.
-- For an api-key provider that is the real bill. For an OAuth one -- a ChatGPT
-- or Copilot subscription -- nothing is charged per token, so the number was
-- an estimate of what avulso WOULD have cost, booked as if it had been spent.
-- Settings -> Usage summed the two together and overstated real spending by
-- ~US$4.90 across 151 runs.
--
-- Going forward the run service books zero for these providers. This clears
-- what was already written, or the screen would keep lying about the past.
-- The ids are named literally on purpose: a migration records what was true
-- when it ran, and must not drift when the provider list changes later.
--
-- tokens_in/tokens_out are deliberately untouched. They are true whoever
-- billed, and they are what makes a subscription's usage comparable at all.

UPDATE llm_runs
   SET cost = 0
 WHERE provider IN ('openai-codex', 'github-copilot');
