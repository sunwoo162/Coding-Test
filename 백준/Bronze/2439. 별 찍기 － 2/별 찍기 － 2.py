a = int(input())
b = 0
for i in range(a):
    b += 1
    print(" " * (a-b)+"*"*b)