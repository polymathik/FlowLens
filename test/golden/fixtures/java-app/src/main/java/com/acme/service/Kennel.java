package com.acme.service;

import com.acme.model.Animal;
import com.acme.model.Dog;
import java.util.List;

public class Kennel {
    public Animal adopt() {
        Dog d = new Dog();
        d.speak();
        return d;
    }

    public void fail() throws KennelException {
        throw new KennelException();
    }
}
