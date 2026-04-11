N, K = map(int, input().split())
numbers = []
for i in range(1, N + 1):
    numbers.append(i)
kill = 0
print('<',end='')
while len(numbers) > 1:
    kill += K - 1
    kill = kill % len(numbers)
    print(numbers.pop(kill), end=",")
print(numbers[0],end='')
print('>')
'<3,6,2,7,5,1,4>'