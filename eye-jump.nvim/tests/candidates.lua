vim.opt.runtimepath:prepend(vim.fn.getcwd())
local jump = require('eye_jump')
local search_area = require('eye_jump.search_area')
local debug_marker = require('eye_jump.debug')
local uv = vim.uv or vim.loop
vim.o.columns, vim.o.lines = 80, 24
vim.o.number, vim.o.relativenumber, vim.o.wrap = false, false, false
vim.o.signcolumn = 'no'
vim.o.scrolloff = 0
vim.o.showtabline = 0
vim.cmd('enew!')
local win = vim.api.nvim_get_current_win()
local rows, cols = vim.o.lines, vim.o.columns
local viewport = { x = 0, y = 0, width = 1, height = 1 }
local transform = { x = { 1, 0, 0 }, y = { 0, 1, 0 } }
local lines = {}
for i = 1, 12 do lines[i] = string.rep(i == 5 and 'x' or '.', 70) end
vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
vim.cmd('redraw!')

local function equal(actual, expected)
  assert(vim.deep_equal(actual, expected), vim.inspect({ actual = actual, expected = expected }))
end

local function near(row, col)
  return { version = 1, source = 'demo', point = { x = (col - 0.5) / cols, y = (row - 0.5) / rows },
    display = { width = cols * 10, height = rows * 20 } }
end

local frame = near(5, 31)
local area = search_area.new(transform, frame, rows, cols, 10)
assert(area:contains(5, 41), 'horizontal boundary excluded')
assert(area:contains(10, 31), 'vertical boundary excluded')
assert(not area:contains(5, 42), 'outside horizontal radius included')
assert(not area:contains(11, 31), 'cell aspect ratio ignored')
assert(not area:contains(10, 32), 'rectangular corner included')
local scaled = { x = { 0.5, 0, 0.1 }, y = { 0, 0.5, 0.2 } }
local scaled_frame = vim.deepcopy(frame)
scaled_frame.point = { x = 0.1 + frame.point.x * 0.5, y = 0.2 + frame.point.y * 0.5 }
local scaled_area = search_area.new(scaled, scaled_frame, rows, cols, 10)
assert(scaled_area:contains(5, 41) and not scaled_area:contains(11, 31), 'alignment scaling changed radius in cells')
local sheared = { x = { 0.8, 0.1, 0.05 }, y = { 0.2, 0.6, 0.1 } }
local sheared_frame = vim.deepcopy(frame)
sheared_frame.point = { x = 0.8 * frame.point.x + 0.1 * frame.point.y + 0.05,
  y = 0.2 * frame.point.x + 0.6 * frame.point.y + 0.1 }
local sheared_area = search_area.new(sheared, sheared_frame, rows, cols, 10)
assert(sheared_area:contains(5, 41), 'sheared boundary excluded')
assert(not sheared_area:contains(5, 42), 'sheared horizontal radius expanded')
assert(math.abs(sheared_area:distance(6, 31) - ((80 / 24) ^ 2 + 12 ^ 2)) < 1e-8,
  'affine row/column displacement ignored')

local candidates = jump.find_candidates(win, 'x', frame, viewport, rows, cols)
equal(#candidates, 21) -- Radius bounds the set, not an arbitrary candidate limit.
equal(candidates[1].position, { 5, 30 })
local seen = {}
for i, candidate in ipairs(candidates) do
  local key = table.concat(candidate.position, ':')
  assert(not seen[key], 'duplicate candidate')
  seen[key] = true
  assert(candidate.distance <= 10000 + 1e-8, 'candidate outside radius')
  if i > 1 then assert(candidate.distance >= candidates[i - 1].distance, 'unsorted candidates') end
end
equal(#jump.find_candidates(win, 'x', frame, viewport, rows, cols, 'smart', 2), 5)
equal(#jump.find_candidates(win, 'x', frame, viewport, rows, cols, 'smart', 20), 41)
equal(#jump.find_candidates(win, 'z', frame, viewport, rows, cols), 0)
equal(#jump.find_candidates(win, 'x', near(11, 31), viewport, rows, cols), 0)
for _, radius in ipairs({ 0, -1, math.huge, '10', false }) do
  local ok, err = pcall(jump.setup, { search_radius = radius })
  assert(not ok and err:find('eye_jump: invalid search_radius', 1, true), 'invalid radius accepted')
end

local path = vim.fn.tempname()
local server = uv.new_pipe(false)
assert(server:bind(path) == 0)
local peer
server:listen(8, function(err)
  assert(not err, err)
  peer = uv.new_pipe(false)
  server:accept(peer)
  peer:write(vim.json.encode(frame) .. '\n')
end)
vim.keymap.set('n', 's', jump.jump)
-- Exercise the README's optional native-repeat fallback, without expr/textlock.
vim.keymap.set('n', ';', function()
  if not jump.next_candidate() then vim.cmd.normal({ ';', bang = true }) end
end)
vim.keymap.set('n', ',', function()
  if not jump.previous_candidate() then vim.cmd.normal({ ',', bang = true }) end
end)

local function feed(keys)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, false, true), 'xt', false)
end

local function publish(sample)
  peer:write(vim.json.encode(sample) .. '\n')
  assert(vim.wait(1000, function()
    local point = jump.status().point
    return point and math.abs(point.x - sample.point.x) < 1e-10 and math.abs(point.y - sample.point.y) < 1e-10
  end, 5), 'sample not received')
end

local function start(opts)
  jump.stop()
  if peer and not peer:is_closing() then peer:close() end
  frame = near(5, 31)
  jump.setup(vim.tbl_extend('force', { viewport = viewport, socket = path, allow_demo = true,
    max_age_ms = 5000, alignment_path = path .. '.alignment' }, opts or {}))
  assert(vim.wait(1000, function() return jump.status().ready end, 5), 'no initial sample')
  vim.api.nvim_win_set_cursor(win, { 1, 0 })
  vim.cmd('redraw!')
  feed('sx')
  equal(vim.api.nvim_win_get_cursor(win), { 5, 30 })
end

start()
-- Freeze candidates even when gaze moves or becomes invalid.
local notifications = {}
local original_notify = vim.notify
vim.notify = function(message) notifications[#notifications + 1] = message end
publish(near(5, 60))
local visited = { ['5:30'] = true }
for i = 2, #candidates do
  feed(';')
  local cursor = vim.api.nvim_win_get_cursor(win)
  equal(cursor, candidates[i].position)
  local key = table.concat(cursor, ':')
  assert(not visited[key], 'forward correction revisited a target')
  visited[key] = true
end
feed(';')
equal(vim.api.nvim_win_get_cursor(win), candidates[#candidates].position)
feed(',')
equal(vim.api.nvim_win_get_cursor(win), candidates[#candidates - 1].position)
peer:write(vim.json.encode({ version = 1, source = 'demo', display = frame.display, point = vim.NIL }) .. '\n')
assert(vim.wait(1000, function() return not jump.status().ready end, 5))
assert(jump.previous_candidate(), 'invalid gaze discarded captured candidates')
equal(vim.api.nvim_win_get_cursor(win), candidates[#candidates - 2].position)

start({ search_radius = 1 })
assert(jump.next_candidate())
assert(jump.next_candidate())
local final = vim.api.nvim_win_get_cursor(win)
assert(jump.next_candidate()) -- Exhaustion is handled, not native fallback.
equal(vim.api.nvim_win_get_cursor(win), final)
-- Neither successful correction nor reaching either end should trigger popups.
assert(jump.previous_candidate())
assert(jump.previous_candidate())
assert(jump.previous_candidate())
equal(#notifications, 0)
vim.notify = original_notify

start()
feed('h')
assert(not jump.next_candidate(), 'unrelated movement retained correction')
start()
feed('i<Esc>')
assert(not jump.next_candidate(), 'insert mode retained correction')
start()
vim.api.nvim_buf_set_text(0, 0, 0, 0, 1, { 'y' })
assert(not jump.next_candidate(), 'edit retained correction')
start()
feed('fz') -- Failed character-find must still restore native ;/, ownership.
assert(not jump.next_candidate(), 'failed native find retained correction')
feed('0fx;')
equal(vim.api.nvim_win_get_cursor(win), { 5, 2 })
feed(',')
equal(vim.api.nvim_win_get_cursor(win), { 5, 1 })
start()
feed('sz')
assert(not jump.next_candidate(), 'failed new jump retained old candidates')
start()
feed('s<Esc>')
assert(not jump.next_candidate(), 'cancelled new jump retained old candidates')
start()
vim.cmd('split')
assert(not jump.next_candidate(), 'window change retained correction')
vim.cmd('close')
vim.api.nvim_set_current_win(win)
start()
vim.cmd('enew')
assert(not jump.next_candidate(), 'buffer change retained correction')
vim.cmd('buffer #')
start()
vim.o.columns = cols + 1
assert(not jump.next_candidate(), 'grid resize retained correction')
vim.o.columns = cols

-- Boundary rendering must not modify text, take focus, or survive stop.
start()
local before = vim.api.nvim_buf_get_lines(0, 0, -1, false)
local cursor = vim.api.nvim_win_get_cursor(win)
jump.toggle_debug()
assert(vim.wait(1000, function()
  local state = debug_marker.status()
  return state.visible and #state.boundary_windows > 0
end, 5), 'marker/boundary not visible')
equal(vim.api.nvim_get_current_win(), win)
equal(vim.api.nvim_win_get_cursor(win), cursor)
equal(vim.api.nvim_buf_get_lines(0, 0, -1, false), before)
local function check_boundary(sample)
  local state = debug_marker.status()
  local expected_area = search_area.new(transform, sample, rows, cols, 10)
  local actual = {}
  for _, cell in ipairs(state.boundary_cells) do actual[cell.row .. ':' .. cell.col] = true end
  for row = 1, rows - vim.o.cmdheight do
    for col = 1, cols do
      local edge = expected_area:contains(row, col) and
        (not expected_area:contains(row - 1, col) or not expected_area:contains(row + 1, col) or
         not expected_area:contains(row, col - 1) or not expected_area:contains(row, col + 1))
      equal(actual[row .. ':' .. col] == true, edge)
    end
  end
  for _, boundary_win in ipairs(state.boundary_windows) do
    local opts = vim.api.nvim_win_get_config(boundary_win)
    assert(not opts.focusable and opts.height == 1, 'boundary can capture focus or obscure interior')
    local row, col = opts.row + 1, opts.col + 1
    assert(row >= 1 and row <= rows - vim.o.cmdheight and col >= 1 and col + opts.width - 1 <= cols,
      'boundary escaped editor bounds')
    for offset = 0, opts.width - 1 do assert(actual[row .. ':' .. (col + offset)], 'float covers interior') end
  end
end
check_boundary(frame)
local corner = near(1, 1)
publish(corner)
assert(vim.wait(1000, function()
  local state = debug_marker.status()
  return state.row == 1 and state.col == 1 and #state.boundary_windows > 0
end, 5), 'boundary did not follow gaze to edge')
check_boundary(corner)
assert(jump.next_candidate(), 'live outline update invalidated frozen candidates')
equal(vim.api.nvim_win_get_cursor(win), candidates[2].position)
local boundary_windows = debug_marker.status().boundary_windows
peer:write(vim.json.encode({ version = 1, source = 'demo', display = frame.display, point = vim.NIL }) .. '\n')
assert(vim.wait(1000, function()
  return not debug_marker.status().visible and #debug_marker.status().boundary_windows == 0
end, 5), 'invalid gaze retained outline')
for _, boundary_win in ipairs(boundary_windows) do
  assert(not vim.api.nvim_win_is_valid(boundary_win), 'hidden boundary leaked a window')
end
jump.stop()
start({ show_search_radius = false })
jump.toggle_debug()
assert(vim.wait(1000, function() return debug_marker.status().visible end, 5), 'disabled outline hid reticle')
equal(#debug_marker.status().boundary_windows, 0)
equal(#debug_marker.status().boundary_cells, 0)
jump.stop()
assert(not jump.next_candidate(), 'stop retained correction')
assert(not debug_marker.status().visible, 'stop retained marker')
peer:close()
server:close()
uv.fs_unlink(path)
vim.keymap.del('n', 's')
vim.keymap.del('n', ';')
vim.keymap.del('n', ',')
print('Bounded gaze candidates and correction tests passed')
