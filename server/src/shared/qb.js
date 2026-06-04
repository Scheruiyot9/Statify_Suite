/**
 * Lightweight query-builder helper that auto-tracks parameter indices.
 *
 * Usage:
 *   const qb = new QueryBuilder([fixedParam1, fixedParam2]);  // pre-seeded params
 *   const clause = `WHERE company_id = $1 AND name ILIKE $${qb.add('%foo%')}`;
 *   const { rows } = await query(clause, qb.params);
 */
class QueryBuilder {
  constructor(initial = []) {
    this.params = [...initial];
  }

  /** Push a value and return its 1-based placeholder index as a string. */
  add(value) {
    this.params.push(value);
    return `${this.params.length}`;
  }

  /** Convenience: current length (= index of the last added param). */
  get length() {
    return this.params.length;
  }
}

module.exports = QueryBuilder;
