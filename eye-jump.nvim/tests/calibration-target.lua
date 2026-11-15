vim.opt.runtimepath:prepend(assert(vim.env.GAZE_TEST_PLUGIN))
local uv = vim.uv or vim.loop
local calibration = require('gaze_jump.calibration')
vim.o.columns = 80
vim.o.lines = 24

calibration.start({
  samples = function()
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
end

check_target()
vim.api.nvim_feedkeys(' ', 'xt', false)
check_target()
calibration.cancel()
print('Calibration target passed')
