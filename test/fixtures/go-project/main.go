package main

import "fmt"
import (
	"os"
	"strings"
)

type Animal interface {
	Speak() string
}

type Dog struct {
	Name string
	Age  int
}

func (d Dog) Speak() string {
	return "Woof"
}

func NewDog(name string) *Dog {
	return &Dog{Name: name, Age: 0}
}

var MaxRetries = 3

func main() {
	d := NewDog("Rex")
	fmt.Println(d.Speak())
	fmt.Println(d.Name)
	_ = os.Getenv("HOME")
	_ = strings.ToUpper("hello")
}
