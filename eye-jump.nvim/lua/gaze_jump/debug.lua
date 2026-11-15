local uv = vim.uv or vim.loop
local alignment = require('gaze_jump.alignment')
local M = {}

local enabled = false
local timer
local buffer
local window
local position
local get_sample
local refresh_pending = false

local function hide()
  if window and vim.api.nvim_win_is_valid(window) then
    pcall(vim.api.nvim_win_close, window, true)
  end
  window = nil
  position = nil
end

local function refresh()
  refresh_pending = false
  if not enabled then return end
  local sample = get_sample()
  if not sample then hide(); return end
  local u, v = alignment.to_grid(sample.transform, sample.point.x, sample.point.y)
  if not u or u < 0 or u > 1 or v < 0 or v > 1 then hide(); return end

  local rows, cols = vim.o.lines, vim.o.columns
  local row = math.min(rows, math.floor(v * rows) + 1)
  local col = math.min(cols, math.floor(u * cols) + 1)
  -- A float cannot reliably overlay Neovim's command-line area.
  if row > rows - vim.o.cmdheight then hide(); return end
  if window and vim.api.nvim_win_is_valid(window) and position and
      position.row == row and position.col == col then return end

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
    local ok = pcall(vim.api.nvim_win_set_config, window, opts)
    if not ok then hide(); return end
  else
    opts.noautocmd = true
    local ok, result = pcall(vim.api.nvim_open_win, buffer, false, opts)
    if not ok then hide(); return end
    window = result
    vim.wo[window].winhighlight = 'Normal:GazeJumpMarker,NormalFloat:GazeJumpMarker'
    vim.wo[window].winblend = 0
  end
  position = { row = row, col = col }
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
  get_sample = nil
end

function M.toggle(sample)
  if enabled then M.stop(); return false end
  get_sample = sample
  enabled = true
  vim.api.nvim_set_hl(0, 'GazeJumpMarker', { fg = '#161616', bg = '#ffdd00', bold = true, default = true })
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
  return { enabled = enabled, visible = position ~= nil, row = position and position.row,
    col = position and position.col, window = window }
end

return M
