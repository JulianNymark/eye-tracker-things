vim.opt.runtimepath:prepend(assert(vim.env.GAZE_TEST_PLUGIN))
local uv = vim.uv or vim.loop
local calibration = require('gaze_jump.calibration')
vim.o.columns = 80
vim.o.lines = 24

local last_since
calibration.start({
  status = function() return { connected = true, ready = true, point = { x = 0.25, y = 0.75 } } end,
  samples = function(since)
    last_since = since
    local now = uv.hrtime()
    local frame = { point = { x = 0.5, y = 0.5 } }
    return { { received = now - 100000000, frame = frame },
      { received = now - 50000000, frame = frame }, { received = now, frame = frame } }
  end,
})

local function check_target()
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_win_get_buf(win)
  local ns = assert(vim.api.nvim_get_namespaces().gaze_jump_calibration_target)
  local marks = vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })
  assert(#marks == 1 and marks[1][4].hl_group == 'GazeJumpCalibrationTarget')
  local mark = marks[1]
  local line = vim.api.nvim_buf_get_lines(buf, mark[2], mark[2] + 1, false)[1]
  assert(mark[4].end_col == mark[3] + 1, 'target must highlight one cell')
  assert(line:sub(mark[3] + 1, mark[3] + 1) == ' ', 'target must not depend on a glyph')
  local pos = vim.fn.screenpos(win, mark[2] + 1, mark[3] + 1)
  local target = assert(calibration.target())
  assert(pos.row == target.row and pos.col == target.col, 'highlight and fitted target differ')
  return mark[2] + 1, mark[3] + 1
end

check_target()
vim.api.nvim_feedkeys(' ', 'xt', false)
local top, left = check_target()
assert(top == 4 and left == 5, 'original top-left target should be restored')
vim.api.nvim_feedkeys('s', 'xt', false)
local since = last_since
local status = vim.api.nvim_buf_get_lines(0, 1, 2, false)[1]
assert(status:find('B:up G:ok N:3', 1, true) and status:find('P:0.25,0.75', 1, true), status)
local same_top, same_left = check_target()
assert(same_top == top and same_left == left, 'status must not advance calibration')
vim.api.nvim_feedkeys('s', 'xt', false)
assert(last_since == since, 'status must not reset sample collection')
vim.api.nvim_feedkeys(' ', 'xt', false)
local top_right, right = check_target()
assert(top_right == top and right == 80 - left + 1, 'top targets must be symmetric')
vim.api.nvim_feedkeys(' ', 'xt', false)
local bottom, bottom_right = check_target()
assert(bottom == (vim.o.lines - vim.o.cmdheight) - 2 and bottom_right == right,
  'original bottom-right target should be restored')
calibration.cancel()
print('Calibration target passed')
