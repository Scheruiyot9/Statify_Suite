const ok = (res, data, meta = null) => {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.status(200).json(payload);
};

const created = (res, data) =>
  res.status(201).json({ success: true, data });

const noContent = (res) =>
  res.status(204).send();

const paginated = (res, data, { page, limit, total }) =>
  res.status(200).json({
    success: true,
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });

module.exports = { ok, created, noContent, paginated };
