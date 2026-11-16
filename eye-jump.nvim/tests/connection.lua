vim.opt.runtimepath:prepend(assert(vim.env.GAZE_TEST_PLUGIN))
local uv = vim.uv or vim.loop
local jump = require('eye_jump')
local path = vim.fn.tempname()
local notifications = {}
vim.notify = function(message) notifications[#notifications + 1] = message end

jump.setup({ socket = path, alignment_path = vim.fn.tempname(), allow_demo = true })
assert(not jump.status().connected and not jump.status().ready)
jump.jump()
assert(notifications[#notifications]:find('bridge not connected', 1, true))

local server = uv.new_pipe(false)
assert(server:bind(path) == 0)
local peer
server:listen(1, function(err)
  assert(not err, err)
  peer = uv.new_pipe(false)
  server:accept(peer)
end)
assert(vim.wait(3000, function() return jump.status().connected end, 10), 'bridge did not connect')
assert(not jump.status().ready)
jump.jump()
assert(notifications[#notifications]:find('bridge connected, but no fresh gaze', 1, true))

peer:write(vim.json.encode({ version = 1, source = 'demo', display = { width = 1920, height = 1080 },
  point = { x = 0.5, y = 0.5 } }) .. '\n')
assert(vim.wait(1000, function() return jump.status().ready end, 10), 'gaze not received')
peer:close()
assert(vim.wait(1000, function() return not jump.status().connected end, 10), 'disconnect not detected')
assert(not jump.status().ready)
jump.jump()
assert(notifications[#notifications]:find('bridge not connected', 1, true))
jump.stop()
server:close()
uv.fs_unlink(path)
print('Bridge connection status passed')
