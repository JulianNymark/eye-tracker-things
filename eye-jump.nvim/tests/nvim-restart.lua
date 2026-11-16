vim.opt.runtimepath:prepend(vim.fn.getcwd())
vim.o.columns = tonumber(assert(vim.env.GAZE_TEST_COLS))
vim.o.lines = tonumber(assert(vim.env.GAZE_TEST_ROWS))
local jump = require('eye_jump')
jump.setup({ socket = assert(vim.env.GAZE_TEST_SOCKET), alignment_path = assert(vim.env.GAZE_TEST_ALIGNMENT), max_age_ms = 2000 })
assert(vim.wait(3000, function() return jump.status().ready end, 10), 'no gaze sample')
local status = jump.status()
assert(status.alignment == vim.env.GAZE_TEST_ALIGNMENT_STATE, vim.inspect(status))
assert(status.aligned == (vim.env.GAZE_TEST_ALIGNMENT_STATE ~= 'tracker_setup_changed'), vim.inspect(status))
if status.aligned then
  local transform = jump.active_transform({ source = 'tobii', setup = 'canonical',
    setupAliases = { 'legacy' }, display = { width = 1920, height = 1080 } })
  local x, y = require('eye_jump.alignment').to_gaze(transform, 19.5 / vim.o.columns, 9.5 / vim.o.lines)
  assert(math.abs(x - (0.1 + 0.8 * 19.5 / 80)) < 1e-10)
  assert(math.abs(y - (0.1 + 0.8 * 9.5 / 24)) < 1e-10)
end
jump.stop()
print('Fresh Neovim alignment: ' .. status.alignment)
