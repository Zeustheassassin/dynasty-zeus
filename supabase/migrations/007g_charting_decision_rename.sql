-- Rename charting_decision enum values to match new UI labels
UPDATE prospects SET charting_decision = 'fully_charted' WHERE charting_decision = 'charted';
UPDATE prospects SET charting_decision = 'pending'       WHERE charting_decision = 'declared';
UPDATE prospects SET charting_decision = 'not_charting'  WHERE charting_decision = 'skipped';
-- 'pending' stays 'pending'
