package com.acme.model;

public class Dog extends Animal implements Pet {
    @Override
    public String speak() {
        return "woof";
    }

    @Override
    public void play() {
        eat();
    }

    public void bark() {}

    public void bark(int times) {}
}
