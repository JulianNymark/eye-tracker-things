vim.g.mapleader = ' '
vim.go.loadplugins = true
vim.opt.runtimepath:prepend(assert(vim.env.GAZE_TEST_LAZY_PATH))
vim.o.columns = 80
vim.o.lines = 24
local socket = assert(vim.env.GAZE_TEST_SOCKET)
local state = assert(vim.env.GAZE_TEST_DIR)

require('lazy').setup({
  {
    dir = vim.fn.getcwd(), name = 'eye-jump', main = 'gaze_jump', event = 'VeryLazy',
    opts = { socket = socket, alignment_path = state .. '/alignment.json', max_age_ms = 2000 },
    keys = {
      { 'S', function() require('gaze_jump').jump() end, desc = 'Jump near gaze' },
      { '<leader>ec', function() require('gaze_jump').calibrate() end, desc = 'Calibrate eye alignment' },
      { '<leader>es', function() require('gaze_jump').show_status() end, desc = 'Eye tracker status' },
      { '<leader>te', function() require('gaze_jump').toggle_debug() end, desc = 'Toggle gaze marker' },
    },
  },
}, {
  root = state .. '/lazy-root', lockfile = state .. '/lazy-lock.json', local_spec = false,
  install = { missing = false }, checker = { enabled = false }, change_detection = { enabled = false },
  rocks = { enabled = false }, performance = { cache = { enabled = false } },
})

assert(package.loaded.gaze_jump == nil, 'plugin should not load during startup')
assert(vim.fn.maparg(' te', 'n', false, true).desc == 'Toggle gaze marker', 'lazy keybinding was not registered')
vim.api.nvim_feedkeys(' te', 'xt', false)
assert(vim.wait(2000, function() return package.loaded.gaze_jump ~= nil end, 10), 'keybinding did not load the plugin')
local jump = require('gaze_jump')
assert(vim.wait(3000, function() return jump.status().ready and jump.status().aligned end, 10), 'lazy-loaded plugin did not connect or restore alignment')
assert(require('gaze_jump.debug').status().enabled, 'toggle did not run after lazy load')
assert(vim.fn.maparg('S', 'n', false, true).desc == 'Jump near gaze')
assert(vim.fn.maparg(' ec', 'n', false, true).desc == 'Calibrate eye alignment')
assert(vim.fn.maparg(' es', 'n', false, true).desc == 'Eye tracker status')
assert(vim.fn.maparg(' te', 'n', false, true).desc == 'Toggle gaze marker')
vim.api.nvim_buf_set_lines(0, 0, -1, false, { 'a x b' })
vim.cmd('redraw!')
vim.api.nvim_feedkeys('Sx', 'xt', false)
assert(vim.api.nvim_win_get_cursor(0)[2] == 2, 'lazy keybinding did not jump')
jump.stop()
print('lazy.nvim local plugin and keybindings passed')
