-- Dune query: sandwich verdict for one victim tx hash.
-- Parameter: {{tx_hash}}  (Dune "Text" parameter, lowercase 0x…)
-- Returns 0 rows -> not sandwiched. 1 row -> sandwiched, with estimated extracted USD.
--
-- Loss is DERIVED (no loss column exists): attacker profit for the bracket
-- = back-run proceeds - front-run cost. Approximate; may be null; a bracket
-- can hold multiple victims, so treat as an upper-bound estimate for this victim.

WITH victim AS (
    SELECT block_time, tx_hash, project_contract_address,
           token_sold_address, token_bought_address, evt_index,
           amount_usd AS victim_trade_usd
    FROM dex.sandwiched
    WHERE tx_hash = from_hex(substr('{{tx_hash}}', 3))   -- strip 0x -> varbinary
),
-- attacker front-run: same pool/block, mirrored direction, before the victim
front AS (
    SELECT v.tx_hash AS victim_tx, s.tx_from, s.evt_index, s.amount_usd
    FROM victim v
    JOIN dex.sandwiches s
      ON s.block_time = v.block_time
     AND s.project_contract_address = v.project_contract_address
     AND s.token_bought_address = v.token_sold_address     -- attacker buys what victim sells
     AND s.token_sold_address   = v.token_bought_address
     AND s.evt_index < v.evt_index
),
-- attacker back-run: same attacker (tx_from), same pool, after the victim
back AS (
    SELECT v.tx_hash AS victim_tx, s.tx_from, s.evt_index, s.amount_usd
    FROM victim v
    JOIN dex.sandwiches s
      ON s.block_time = v.block_time
     AND s.project_contract_address = v.project_contract_address
     AND s.token_sold_address   = v.token_sold_address     -- attacker sells it back
     AND s.token_bought_address = v.token_bought_address
     AND s.evt_index > v.evt_index
)
SELECT v.tx_hash,
       v.victim_trade_usd,
       f.amount_usd AS front_usd,
       b.amount_usd AS back_usd,
       (b.amount_usd - f.amount_usd) AS est_extracted_usd
FROM victim v
JOIN front f ON f.victim_tx = v.tx_hash
JOIN back  b ON b.victim_tx = v.tx_hash AND b.tx_from = f.tx_from
ORDER BY est_extracted_usd DESC
LIMIT 1;
