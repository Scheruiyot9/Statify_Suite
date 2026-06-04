const { query } = require('../../config/database');
const AppError  = require('../../shared/AppError');

async function listTaxRates(companyId) {
  const { rows } = await query(
    `SELECT tax_template_id, template_name, tax_type, tax_rate::numeric,
            is_inclusive, is_default
     FROM tax_templates WHERE company_id = $1
     ORDER BY is_default DESC, template_name`,
    [companyId]
  );
  return rows.map((r) => ({ ...r, tax_rate: parseFloat(r.tax_rate) }));
}

async function createTaxRate(companyId, { template_name, tax_type, tax_rate, is_inclusive, is_default }) {
  if (is_default) await query(`UPDATE tax_templates SET is_default = FALSE WHERE company_id = $1`, [companyId]);
  const { rows } = await query(`
    INSERT INTO tax_templates (company_id, template_name, tax_type, tax_rate, is_inclusive, is_default)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [companyId, template_name, tax_type ?? 'VAT', tax_rate ?? 0, is_inclusive ?? false, is_default ?? false]);
  return { ...rows[0], tax_rate: parseFloat(rows[0].tax_rate) };
}

async function updateTaxRate(companyId, id, { template_name, tax_type, tax_rate, is_inclusive, is_default }) {
  if (is_default) await query(`UPDATE tax_templates SET is_default = FALSE WHERE company_id = $1 AND tax_template_id <> $2`, [companyId, id]);
  const { rows } = await query(`
    UPDATE tax_templates
    SET template_name = COALESCE($3, template_name),
        tax_type      = COALESCE($4, tax_type),
        tax_rate      = COALESCE($5, tax_rate),
        is_inclusive  = COALESCE($6, is_inclusive),
        is_default    = COALESCE($7, is_default)
    WHERE company_id = $1 AND tax_template_id = $2
    RETURNING *
  `, [companyId, id, template_name ?? null, tax_type ?? null, tax_rate ?? null, is_inclusive ?? null, is_default ?? null]);
  if (!rows.length) throw AppError.notFound('Tax rate');
  return { ...rows[0], tax_rate: parseFloat(rows[0].tax_rate) };
}

async function deleteTaxRate(companyId, id) {
  const { rows } = await query(
    `DELETE FROM tax_templates WHERE company_id = $1 AND tax_template_id = $2 RETURNING tax_template_id`,
    [companyId, id]
  );
  if (!rows.length) throw AppError.notFound('Tax rate');
}

async function getDefaultTaxRate(companyId) {
  const { rows } = await query(
    `SELECT tax_template_id, template_name, tax_type, tax_rate::numeric, is_inclusive
     FROM tax_templates WHERE company_id = $1 AND is_default = TRUE LIMIT 1`,
    [companyId]
  );
  return rows.length ? { ...rows[0], tax_rate: parseFloat(rows[0].tax_rate) } : null;
}

module.exports = { listTaxRates, createTaxRate, updateTaxRate, deleteTaxRate, getDefaultTaxRate };
