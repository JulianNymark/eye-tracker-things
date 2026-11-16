local uv = vim.uv or vim.loop
local alignment = require('eye_jump.alignment')
local search_area = require('eye_jump.search_area')
local M = {}

local enabled = false
local timer
local buffer
local window
local position
local get_sample
local refresh_pending = false
local boundary_windows = {}
local boundary_buffers = {}
local boundary_cells = {}
local boundary_signature

local function finite(value)
  return type(value) == 'number' and value == value and math.abs(value) < math.huge
end

local function hide_boundary()
  for _, win in pairs(boundary_windows) do
    if vim.api.nvim_win_is_valid(win) then pcall(vim.api.nvim_win_close, win, true) end
  end
  boundary_windows = {}
  boundary_cells = {}
  boundary_signature = nil
end

local function hide()
  hide_boundary()
  if window and vim.api.nvim_win_is_valid(window) then
    pcall(vim.api.nvim_win_close, window, true)
  end
  window = nil
  position = nil
end

local function boundary_buffer(width)
  local buf = boundary_buffers[width]
  if buf and vim.api.nvim_buf_is_valid(buf) then return buf end
  buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'hide'
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { string.rep('.', width) })
  vim.bo[buf].modifiable = false
  boundary_buffers[width] = buf
  return buf
end

local function draw_boundary(sample, rows, cols, u, v)
  local display = sample.display
  local radius = sample.search_radius == nil and 10 or sample.search_radius
  if sample.show_search_radius == false or type(display) ~= 'table' or
      not finite(display.width) or not finite(display.height) or display.width <= 0 or display.height <= 0 or
      not finite(radius) or radius < 0 then
    hide_boundary()
    return
  end

  local x, y = sample.transform.x, sample.transform.y
  local signature = { rows, cols, vim.o.cmdheight, sample.point.x, sample.point.y,
    display.width, display.height, radius, x[1], x[2], x[3], y[1], y[2], y[3] }
  local same = boundary_signature ~= nil
  if same then
    for i, value in ipairs(signature) do
      if boundary_signature[i] ~= value then same = false; break end
    end
  end
  if same then
    for _, win in pairs(boundary_windows) do
      if not vim.api.nvim_win_is_valid(win) then same = false; break end
    end
  end
  if same then return end

  local area = search_area.new(sample.transform, sample, rows, cols, radius)
  local a, b = x[1] * display.width / cols, x[2] * display.width / rows
  local c, d = y[1] * display.height / cols, y[2] * display.height / rows
  local determinant = math.abs(a * d - b * c)
  if not finite(determinant) or determinant == 0 or not finite(area.radius_squared) then
    hide_boundary()
    return
  end
  local pixel_radius = math.sqrt(area.radius_squared)
  local col_radius = pixel_radius * math.sqrt(d * d + b * b) / determinant
  local row_radius = pixel_radius * math.sqrt(c * c + a * a) / determinant
  local min_col = math.max(1, math.floor(u * cols + 0.5 - col_radius))
  local max_col = math.min(cols, math.ceil(u * cols + 0.5 + col_radius))
  local min_row = math.max(1, math.floor(v * rows + 0.5 - row_radius))
  local max_row = math.min(rows - vim.o.cmdheight, math.ceil(v * rows + 0.5 + row_radius))
  local runs, cells = {}, {}
  for row = min_row, max_row do
    local start
    for col = min_col, max_col + 1 do
      local edge = col <= max_col and area:contains(row, col) and
        (not area:contains(row - 1, col) or not area:contains(row + 1, col) or
         not area:contains(row, col - 1) or not area:contains(row, col + 1))
      if edge then
        start = start or col
        cells[#cells + 1] = { row = row, col = col }
      elseif start then
        local width = col - start
        local key = row .. ':' .. start .. ':' .. width
        runs[#runs + 1] = { key = key, row = row, col = start, width = width }
        start = nil
      end
    end
  end

  local next_windows, spare = {}, {}
  for _, run in ipairs(runs) do
    local win = boundary_windows[run.key]
    if win and vim.api.nvim_win_is_valid(win) then next_windows[run.key] = win end
  end
  for key, win in pairs(boundary_windows) do
    if not next_windows[key] and vim.api.nvim_win_is_valid(win) then spare[#spare + 1] = win end
  end
  for _, run in ipairs(runs) do
    if not next_windows[run.key] then
      local opts = { relative = 'editor', row = run.row - 1, col = run.col - 1,
        width = run.width, height = 1, style = 'minimal', focusable = false, zindex = 79 }
      local buf = boundary_buffer(run.width)
      local win = table.remove(spare)
      local ok
      if win then
        ok = pcall(vim.api.nvim_win_set_buf, win, buf)
        if ok then ok = pcall(vim.api.nvim_win_set_config, win, opts) end
        if not ok then pcall(vim.api.nvim_win_close, win, true); win = nil end
      else
        opts.noautocmd = true
        ok, win = pcall(vim.api.nvim_open_win, buf, false, opts)
        if not ok then win = nil end
      end
      if win then
        vim.wo[win].winhighlight = 'Normal:EyeJumpBoundary,NormalFloat:EyeJumpBoundary'
        vim.wo[win].winblend = 40
        next_windows[run.key] = win
      end
    end
  end
  for _, win in ipairs(spare) do pcall(vim.api.nvim_win_close, win, true) end
  local complete = true
  for _, run in ipairs(runs) do
    if not next_windows[run.key] then complete = false; break end
  end
  boundary_windows, boundary_cells = next_windows, cells
  boundary_signature = complete and signature or nil
end

local function refresh()
  refresh_pending = false
  if not enabled then return end
  local sample = get_sample()
  if type(sample) ~= 'table' or type(sample.point) ~= 'table' or
      not finite(sample.point.x) or not finite(sample.point.y) or type(sample.transform) ~= 'table' or
      type(sample.transform.x) ~= 'table' or type(sample.transform.y) ~= 'table' then hide(); return end
  for i = 1, 3 do
    if not finite(sample.transform.x[i]) or not finite(sample.transform.y[i]) then hide(); return end
  end
  local u, v = alignment.to_grid(sample.transform, sample.point.x, sample.point.y)
  if not finite(u) or not finite(v) or u < 0 or u > 1 or v < 0 or v > 1 then hide(); return end

  local rows, cols = vim.o.lines, vim.o.columns
  local row = math.min(rows, math.floor(v * rows) + 1)
  local col = math.min(cols, math.floor(u * cols) + 1)
  -- A float cannot reliably overlay Neovim's command-line area.
  if row > rows - vim.o.cmdheight then hide(); return end
  if not buffer or not vim.api.nvim_buf_is_valid(buffer) then
    buffer = vim.api.nvim_create_buf(false, true)
    vim.bo[buffer].bufhidden = 'hide'
    local marker = vim.fn.strdisplaywidth('●') == 1 and '●' or '+'
    vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { marker })
    vim.bo[buffer].modifiable = false
  end
  local opts = { relative = 'editor', row = row - 1, col = col - 1,
    width = 1, height = 1, style = 'minimal', focusable = false, zindex = 80 }
  if window and vim.api.nvim_win_is_valid(window) then
    if not position or position.row ~= row or position.col ~= col then
      local ok = pcall(vim.api.nvim_win_set_config, window, opts)
      if not ok then hide(); return end
    end
  else
    opts.noautocmd = true
    local ok, result = pcall(vim.api.nvim_open_win, buffer, false, opts)
    if not ok then hide(); return end
    window = result
    vim.wo[window].winhighlight = 'Normal:EyeJumpMarker,NormalFloat:EyeJumpMarker'
    vim.wo[window].winblend = 0
  end
  position = { row = row, col = col }
  draw_boundary(sample, rows, cols, u, v)
end

function M.stop()
  enabled = false
  if timer and not timer:is_closing() then timer:stop(); timer:close() end
  timer = nil
  hide()
  if buffer and vim.api.nvim_buf_is_valid(buffer) then
    pcall(vim.api.nvim_buf_delete, buffer, { force = true })
  end
  buffer = nil
  for _, buf in pairs(boundary_buffers) do
    if vim.api.nvim_buf_is_valid(buf) then pcall(vim.api.nvim_buf_delete, buf, { force = true }) end
  end
  boundary_buffers = {}
  get_sample = nil
end

function M.toggle(sample)
  if enabled then M.stop(); return false end
  get_sample = sample
  enabled = true
  vim.api.nvim_set_hl(0, 'EyeJumpMarker', { fg = '#161616', bg = '#ffdd00', bold = true, default = true })
  vim.api.nvim_set_hl(0, 'EyeJumpBoundary', { fg = '#888888', bg = '#202020', default = true })
  timer = uv.new_timer()
  timer:start(0, 33, function()
    if refresh_pending then return end
    refresh_pending = true
    vim.schedule(refresh)
  end)
  timer:unref()
  return true
end

-- Also useful to inspect the marker during automated tests.
function M.status()
  local windows = {}
  for _, win in pairs(boundary_windows) do windows[#windows + 1] = win end
  return { enabled = enabled, visible = position ~= nil, row = position and position.row,
    col = position and position.col, window = window, boundary_windows = windows,
    boundary_cells = vim.deepcopy(boundary_cells) }
end

return M
