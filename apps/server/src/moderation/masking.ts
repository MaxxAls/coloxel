/** A creation reported by this many different players is masked until the staff has looked at it. */
export const REPORT_HIDE_THRESHOLD = 3;

/**
 * SQL condition, true when the creation `alias` is masked for everybody except its owner:
 * the staff hid it, or, with no staff decision yet, enough different players reported it.
 */
export const itemMaskedSql = (alias = 'it') =>
  `(EXISTS (SELECT 1 FROM item_moderation im WHERE im.item_id = ${alias}.id AND im.state = 'hidden')` +
  ` OR (NOT EXISTS (SELECT 1 FROM item_moderation im WHERE im.item_id = ${alias}.id)` +
  ` AND (SELECT count(DISTINCT rp.reporter_id) FROM reports rp WHERE rp.kind = 'item' AND rp.target_key = ${alias}.id::text AND rp.status = 'open') >= ${REPORT_HIDE_THRESHOLD}))`;
