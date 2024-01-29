import torch

x = torch.linspace(0, 4, 16 * 1024 ** 2).cuda()

while True:
    x = x * (1.0 - x)
