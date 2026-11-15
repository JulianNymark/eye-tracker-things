vim.opt.runtimepath:prepend(vim.fn.getcwd())
vim.g.mapleader = ' '
local jump = require('gaze_jump')
local alignment = require('gaze_jump.alignment')
local debug_marker = require('gaze_jump.debug')
vim.opt.number = false
vim.opt.signcolumn = 'no'
vim.opt.wrap = false
vim.api.nvim_buf_set_lines(0, 0, -1, false, {
  'first x far x',
  'second x close',
  '\tx with tab',
  'nonascii øx',
})
vim.cmd('redraw!')
local win = vim.api.nvim_get_current_win()
local rows, cols = vim.o.lines, vim.o.columns
local viewport = { x = 0, y = 0, width = 1, height = 1 }

local function near(line, byte_col)
  local pos = vim.fn.screenpos(win, line, byte_col)
  assert(pos.row > 0 and pos.col > 0, vim.inspect(pos))
  return {
    point = { x = (pos.col - 0.5) / cols, y = (pos.row - 0.5) / rows },
    display = { width = 1920, height = 1080 },
  }
end

local function equal(actual, expected)
  assert(vim.deep_equal(actual, expected), vim.inspect({ actual = actual, expected = expected }))
end

local fit = assert(alignment.fit({
  { u = 0, v = 0, x = 0.1, y = 0.2 },
  { u = 1, v = 0, x = 0.8, y = 0.25 },
  { u = 0, v = 1, x = 0.13, y = 0.8 },
  { u = 1, v = 1, x = 0.83, y = 0.85 },
}))
local gx, gy = alignment.to_gaze(fit, 0.5, 0.5)
local gu, gv = alignment.to_grid(fit, gx, gy)
assert(math.abs(gu - 0.5) < 1e-8 and math.abs(gv - 0.5) < 1e-8)
assert(not alignment.fit({
  { u = 0, v = 0, x = 0, y = 0 }, { u = 0.5, v = 0.5, x = 0.5, y = 0.5 },
  { u = 1, v = 1, x = 1, y = 1 },
}))
local resized = alignment.for_grid(fit, 80, 24, 100, 30)
local old_x, old_y = alignment.to_gaze(fit, 19.5 / 80, 9.5 / 24)
local new_x, new_y = alignment.to_gaze(resized, 19.5 / 100, 9.5 / 30)
assert(math.abs(old_x - new_x) < 1e-10 and math.abs(old_y - new_y) < 1e-10)

equal(jump.find_nearest(win, 'x', near(1, 13), viewport, rows, cols), { 1, 12 })
equal(jump.find_nearest(win, 'x', near(2, 8), viewport, rows, cols), { 2, 7 })
equal(jump.find_nearest(win, 'x', near(3, 2), viewport, rows, cols), { 3, 1 })
equal(jump.find_nearest(win, 'x', near(4, 12), viewport, rows, cols), { 4, 11 })
equal(jump.find_nearest(win, 'ø', near(4, 10), viewport, rows, cols), { 4, 9 })
equal(jump.find_nearest(win, '!', near(1, 7), viewport, rows, cols), nil)
equal(jump.find_nearest(win, 'x', near(1, 7), { x = 0.8, y = 0.8, width = 0.2, height = 0.2 }, rows, cols), nil)

-- Distance is measured in display units, not raw normalized x/y values.
local original_lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
vim.api.nvim_buf_set_lines(0, 0, -1, false, { '....x', '......x' })
vim.cmd('redraw!')
local top = vim.fn.screenpos(win, 1, 5)
local bottom = vim.fn.screenpos(win, 2, 7)
local diagonal = { point = { x = (top.col - 0.5) / cols, y = (bottom.row - 0.5) / rows },
  display = { width = cols * 10, height = rows * 15 } }
equal(jump.find_nearest(win, 'x', diagonal, viewport, rows, cols), { 1, 4 })

-- screenpos() reports folded-away positions at the fold header; do not jump there.
vim.api.nvim_buf_set_lines(0, 0, -1, false, original_lines)
vim.wo[win].foldmethod = 'manual'
vim.cmd('1,3fold')
vim.cmd('redraw!')
assert(vim.fn.foldclosed(2) ~= -1, 'test fold did not close')
equal(jump.find_nearest(win, 'x', near(1, 1), viewport, rows, cols), { 4, 11 })
vim.cmd('normal! zE')
vim.cmd('redraw!')

-- Exercise the socket client, sample capture, character input, and cursor move.
local uv = vim.uv or vim.loop
local path = vim.fn.tempname()
local server = uv.new_pipe(false)
assert(server:bind(path) == 0)
local peer
local frame = near(2, 8)
frame.version = 1
frame.source = 'demo'
server:listen(1, function(err)
  assert(not err, err)
  peer = uv.new_pipe(false)
  server:accept(peer)
  peer:write(vim.json.encode(frame) .. '\n')
end)
vim.keymap.set('n', 'S', function() end, { desc = 'Existing S mapping' })
vim.keymap.set('n', '<leader>te', function() end, { desc = 'Existing toggle mapping' })
jump.setup({ viewport = viewport, socket = path, max_age_ms = 5000, allow_demo = true })
assert(vim.fn.maparg('S', 'n', false, true).desc == 'Existing S mapping', 'setup must not set user mappings')
assert(vim.fn.maparg(' te', 'n', false, true).desc == 'Existing toggle mapping', 'setup must not set user mappings')
vim.keymap.set('n', 'S', jump.jump, { desc = 'Jump to character near gaze' })
vim.keymap.set('n', '<leader>te', jump.toggle_debug, { desc = 'Toggle eye tracking marker' })
assert(vim.wait(2000, function() return jump.status().ready end, 10), 'no socket sample received')
assert(vim.fn.maparg(' te', 'n', false, true).desc == 'Toggle eye tracking marker')
local expected_pos = vim.fn.screenpos(win, 2, 8)
local original_cursor = vim.api.nvim_win_get_cursor(win)
vim.api.nvim_feedkeys(' te', 'xt', false)
assert(vim.wait(2000, function() return debug_marker.status().visible end, 10), 'marker was not shown')
local marker = debug_marker.status()
equal({ marker.row, marker.col }, { expected_pos.row, expected_pos.col })
assert(vim.api.nvim_win_get_config(marker.window).focusable == false, 'marker must not take focus')
equal(vim.api.nvim_get_current_win(), win)
equal(vim.api.nvim_win_get_cursor(win), original_cursor)
vim.cmd('redraw!')
local marker_pos = vim.fn.screenpos(marker.window, 1, 1)
equal({ marker_pos.row, marker_pos.col }, { expected_pos.row, expected_pos.col })
equal(vim.api.nvim_buf_get_lines(0, 0, -1, false), original_lines)
local moved_frame = near(4, 12)
moved_frame.version = 1
moved_frame.source = 'demo'
peer:write(vim.json.encode(moved_frame) .. '\n')
local moved_pos = vim.fn.screenpos(win, 4, 12)
assert(vim.wait(2000, function()
  local state = debug_marker.status()
  return state.visible and state.row == moved_pos.row and state.col == moved_pos.col
end, 10), 'marker did not follow gaze')
equal(vim.api.nvim_get_current_win(), win)
equal(vim.api.nvim_win_get_cursor(win), original_cursor)
peer:write(vim.json.encode(frame) .. '\n')
assert(vim.wait(2000, function()
  local state = debug_marker.status()
  return state.visible and state.row == expected_pos.row and state.col == expected_pos.col
end, 10), 'marker did not return to the original position')
vim.o.showtabline = 2
vim.cmd('redraw!')
local with_tabline = near(2, 8)
with_tabline.version = 1
with_tabline.source = 'demo'
local tabline_pos = vim.fn.screenpos(win, 2, 8)
peer:write(vim.json.encode(with_tabline) .. '\n')
assert(vim.wait(2000, function()
  local state = debug_marker.status()
  return state.visible and state.row == tabline_pos.row and state.col == tabline_pos.col
end, 10), 'marker did not map the global grid with a tabline')
vim.cmd('redraw!')
local tab_marker_pos = vim.fn.screenpos(debug_marker.status().window, 1, 1)
equal({ tab_marker_pos.row, tab_marker_pos.col }, { tabline_pos.row, tabline_pos.col })
vim.o.showtabline = 1
vim.cmd('redraw!')
peer:write(vim.json.encode(frame) .. '\n')
assert(vim.wait(2000, function()
  local state = debug_marker.status()
  return state.visible and state.row == expected_pos.row and state.col == expected_pos.col
end, 10), 'marker did not return after hiding the tabline')
jump.calibrate()
assert(vim.wait(2000, function() return not debug_marker.status().visible end, 10), 'marker must hide during alignment')
require('gaze_jump.calibration').cancel()
assert(vim.wait(2000, function() return debug_marker.status().visible end, 10), 'marker must resume after alignment')
vim.api.nvim_win_set_cursor(win, { 1, 0 })
vim.api.nvim_feedkeys('Sx', 'xt', false)
equal(vim.api.nvim_win_get_cursor(win), { 2, 7 })
peer:write(vim.json.encode({ version = 1, source = 'demo', display = frame.display, point = vim.NIL }) .. '\n')
assert(vim.wait(2000, function() return not jump.status().ready end, 10), 'invalid gaze not cleared')
assert(vim.wait(2000, function() return not debug_marker.status().visible end, 10), 'marker must hide on invalid gaze')
vim.api.nvim_feedkeys(' te', 'xt', false)
assert(not debug_marker.status().enabled, 'marker did not toggle off')
jump.stop()
peer:close()

-- Calibrate through nine drawn targets using a synthetic affine gaze stream.
local cal = require('gaze_jump.calibration')
local saved_path = vim.fn.tempname()
local timer = uv.new_timer()
jump.setup({ socket = path, alignment_path = saved_path, max_age_ms = 5000, allow_demo = true })
assert(vim.wait(2000, function() return jump.status().ready end, 10), 'no gaze before alignment')
timer:start(0, 25, function()
  local target = cal.target()
  local u = target and (target.col - 0.5) / cols or 0.5
  local v = target and (target.row - 0.5) / rows or 0.5
  local sample = { version = 1, source = 'demo', setup = 'test', display = frame.display,
    point = { x = 0.1 + 0.7 * u + 0.03 * v, y = 0.2 + 0.05 * u + 0.6 * v } }
  peer:write(vim.json.encode(sample) .. '\n')
end)
assert(vim.wait(2000, function() return jump.status().setup == 'test' end, 10), 'no synthetic setup before alignment')
jump.calibrate()
for _ = 1, 9 do
  local previous = assert(cal.target(), 'alignment target missing')
  local advanced = false
  for _ = 1, 4 do
    vim.wait(350, function() return false end, 10)
    vim.api.nvim_feedkeys(' ', 'xt', false)
    local next_target = cal.target()
    if not next_target or not vim.deep_equal(previous, next_target) then
      advanced = true
      break
    end
  end
  assert(advanced, 'alignment target did not advance')
end
assert(not cal.target(), 'alignment did not finish')
assert(jump.status().aligned, 'finished alignment is not active')
local saved = assert(cal.load(saved_path .. '.demo'))
assert(saved.setup == 'test' and saved.source == 'demo')
assert(not uv.fs_stat(saved_path), 'demo alignment must not overwrite real alignment')
local x, y = alignment.to_gaze(saved.transform, 0.5, 0.5)
assert(math.abs(x - 0.465) < 0.002 and math.abs(y - 0.525) < 0.002)
timer:stop()
timer:close()
jump.stop()
peer:close()
jump.setup({ socket = path, alignment_path = saved_path, max_age_ms = 5000, allow_demo = true })
assert(vim.wait(2000, function() return jump.status().ready end, 10), 'no gaze after restarting plugin')
local pos = vim.fn.screenpos(win, 2, 8)
x, y = alignment.to_gaze(saved.transform, (pos.col - 0.5) / cols, (pos.row - 0.5) / rows)
peer:write(vim.json.encode({ version = 1, source = 'demo', setup = 'canonical', setupAliases = { 'test' }, display = frame.display,
  point = { x = x, y = y } }) .. '\n')
assert(vim.wait(1000, function()
  local state = jump.status()
  return state.point and math.abs(state.point.x - x) < 1e-8
end, 10), 'calibrated sample not received')
assert(jump.status().aligned and jump.status().alignment == 'ready', 'saved alignment was not reused after restart')
vim.api.nvim_win_set_cursor(win, { 1, 0 })
vim.api.nvim_feedkeys('Sx', 'xt', false)
equal(vim.api.nvim_win_get_cursor(win), { 2, 7 })
vim.o.columns = cols + 10
vim.o.lines = rows + 2
vim.cmd('redraw!')
assert(jump.status().aligned and jump.status().alignment == 'resized', 'saved alignment was rejected after resize')
local remapped = jump.active_transform({ source = 'demo', setup = 'canonical', setupAliases = { 'test' }, display = frame.display })
local remapped_x, remapped_y = alignment.to_gaze(remapped, (pos.col - 0.5) / vim.o.columns, (pos.row - 0.5) / vim.o.lines)
assert(math.abs(remapped_x - x) < 1e-10 and math.abs(remapped_y - y) < 1e-10)
vim.o.columns = cols
vim.o.lines = rows
vim.cmd('redraw!')
peer:write(vim.json.encode({ version = 1, source = 'demo', setup = 'other', display = frame.display,
  point = { x = x, y = y } }) .. '\n')
assert(vim.wait(1000, function() return jump.status().setup == 'other' end, 10))
assert(not jump.status().aligned, 'alignment must not carry over to another tracker setup')
jump.calibrate()
assert(cal.target(), 'second calibration did not start')
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'xt', false)
assert(not cal.target(), 'Escape must cancel alignment')
assert(cal.load(saved_path .. '.demo').setup == 'test', 'cancel must preserve the saved alignment')
jump.stop()
uv.fs_unlink(saved_path .. '.demo')
peer:close()
server:close()
uv.fs_unlink(path)

print('Neovim eye-jump tests passed')
