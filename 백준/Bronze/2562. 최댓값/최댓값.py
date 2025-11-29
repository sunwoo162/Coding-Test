b = 0
c = 0
for i in range(9):
    a = int(input())
    if(a>b):
        b = a
        c = i
print(b)
print(int(c+1))